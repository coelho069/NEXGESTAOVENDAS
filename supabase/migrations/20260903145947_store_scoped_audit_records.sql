-- Enforce store scope for fiscal documents and audit logs.
-- Legacy rows are never assigned a guessed store: the migration fails when
-- an existing row cannot be proven to belong to the sale/store it references.

CREATE UNIQUE INDEX IF NOT EXISTS uq_stores_id_org
  ON public.stores (id, org_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_id_org_store
  ON public.sales (id, org_id, store_id);

ALTER TABLE public.fiscal_documents
  ADD COLUMN IF NOT EXISTS store_id uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.fiscal_documents fd
    JOIN public.sales s ON s.id = fd.sale_id
    WHERE fd.org_id IS DISTINCT FROM s.org_id
      OR (
        fd.store_id IS NOT NULL
        AND fd.store_id IS DISTINCT FROM s.store_id
      )
  ) THEN
    RAISE EXCEPTION 'legacy_fiscal_document_scope_violation'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

UPDATE public.fiscal_documents fd
SET store_id = s.store_id
FROM public.sales s
WHERE s.id = fd.sale_id
  AND fd.store_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.fiscal_documents
    WHERE store_id IS NULL
  ) THEN
    RAISE EXCEPTION 'legacy_fiscal_document_without_store'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE public.fiscal_documents
  ALTER COLUMN store_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'fk_fiscal_documents_sale_store_org'
      AND conrelid = 'public.fiscal_documents'::regclass
  ) THEN
    ALTER TABLE public.fiscal_documents
      ADD CONSTRAINT fk_fiscal_documents_sale_store_org
      FOREIGN KEY (sale_id, store_id, org_id)
      REFERENCES public.sales (id, store_id, org_id)
      ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_fiscal_documents_store_created
  ON public.fiscal_documents (store_id, created_at DESC);

ALTER TABLE public.audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_store_id_fkey;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.audit_logs al
    LEFT JOIN public.stores s
      ON s.id = al.store_id
     AND s.org_id = al.org_id
    WHERE al.store_id IS NULL
      OR s.id IS NULL
  ) THEN
    RAISE EXCEPTION 'legacy_audit_log_without_valid_store'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE public.audit_logs
  ALTER COLUMN store_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'fk_audit_logs_store_org'
      AND conrelid = 'public.audit_logs'::regclass
  ) THEN
    ALTER TABLE public.audit_logs
      ADD CONSTRAINT fk_audit_logs_store_org
      FOREIGN KEY (store_id, org_id)
      REFERENCES public.stores (id, org_id)
      ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_audit_logs_store_created
  ON public.audit_logs (store_id, created_at DESC);

-- process_sale_core predates fiscal_documents.store_id and omits that column.
-- Derive it from the referenced sale before constraints run, while rejecting
-- any attempted cross-store or cross-organization association.
CREATE OR REPLACE FUNCTION public.set_fiscal_document_store_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_sale_store_id uuid;
  v_sale_org_id uuid;
BEGIN
  SELECT s.store_id, s.org_id
  INTO v_sale_store_id, v_sale_org_id
  FROM public.sales s
  WHERE s.id = NEW.sale_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fiscal_document_sale_not_found'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.org_id IS DISTINCT FROM v_sale_org_id
    OR (
      NEW.store_id IS NOT NULL
      AND NEW.store_id IS DISTINCT FROM v_sale_store_id
    )
  THEN
    RAISE EXCEPTION 'fiscal_document_scope_mismatch'
      USING ERRCODE = '23514';
  END IF;

  NEW.store_id := v_sale_store_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_fiscal_document_store_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_fiscal_document_store_scope() FROM anon;
REVOKE ALL ON FUNCTION public.set_fiscal_document_store_scope() FROM authenticated;

DROP TRIGGER IF EXISTS set_fiscal_document_store_scope ON public.fiscal_documents;
CREATE TRIGGER set_fiscal_document_store_scope
  BEFORE INSERT OR UPDATE OF sale_id, store_id, org_id
  ON public.fiscal_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.set_fiscal_document_store_scope();

DROP POLICY IF EXISTS fiscal_documents_select ON public.fiscal_documents;
CREATE POLICY fiscal_documents_store_select ON public.fiscal_documents
  FOR SELECT TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_has_store_access(store_id)
  );

REVOKE INSERT, UPDATE, DELETE ON public.fiscal_documents FROM authenticated;

DROP POLICY IF EXISTS audit_logs_select ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_membership_select ON public.audit_logs;
CREATE POLICY audit_logs_store_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_store_role(store_id) IN ('admin', 'manager')
  );

REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM authenticated;

-- The wrapper remains the sole idempotency boundary. Its response now carries
-- the mutation identity and the fact that the server transaction reconciled
-- stock, so a successful push cannot reserve the same sale a second time
-- during the following pull.
CREATE OR REPLACE FUNCTION public.process_sale(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_store_id uuid;
  v_client_mutation_id uuid;
  v_discount numeric := 0;
  v_gross_subtotal numeric := 0;
  v_item jsonb;
  v_existing_sale_id uuid;
  v_status text;
  v_total numeric(12, 2);
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_sale_payload_integrity(p_payload);

  v_store_id := (p_payload->>'store_id')::uuid;
  v_client_mutation_id := (p_payload->>'client_mutation_id')::uuid;
  v_discount := COALESCE((p_payload->>'discount')::numeric, 0);

  IF v_store_id IS NULL OR v_client_mutation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF NOT public.user_has_store_access(v_store_id) THEN
    RAISE EXCEPTION 'store_access_denied' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_store_id::text || ':' || v_client_mutation_id::text, 0)
  );

  SELECT k.sale_id
  INTO v_existing_sale_id
  FROM public.sale_idempotency_keys k
  WHERE k.store_id = v_store_id
    AND k.client_mutation_id = v_client_mutation_id
  FOR UPDATE;

  IF v_existing_sale_id IS NULL THEN
    SELECT s.id
    INTO v_existing_sale_id
    FROM public.sales s
    WHERE s.store_id = v_store_id
      AND s.client_mutation_id = v_client_mutation_id
    FOR UPDATE;
  END IF;

  IF v_existing_sale_id IS NOT NULL THEN
    SELECT s.status::text, s.total
    INTO v_status, v_total
    FROM public.sales s
    WHERE s.id = v_existing_sale_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'idempotency_incomplete' USING ERRCODE = '40001';
    END IF;
    IF NOT public.sale_payload_matches(v_existing_sale_id, p_payload) THEN
      RAISE EXCEPTION 'idempotency_payload_mismatch' USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'sale_id', v_existing_sale_id,
      'client_mutation_id', v_client_mutation_id,
      'replay', true,
      'status', v_status,
      'total', v_total,
      'stock_reconciled', true
    );
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb)) AS t(value)
  LOOP
    v_gross_subtotal := v_gross_subtotal + round(
      COALESCE((v_item->>'quantity')::numeric, 0)
      * COALESCE((v_item->>'unit_price')::numeric, 0),
      2
    );
    v_discount := v_discount + COALESCE((v_item->>'discount')::numeric, 0);
  END LOOP;

  PERFORM public.assert_sale_discount_cap(v_store_id, v_discount, v_gross_subtotal);

  RETURN public.process_sale_core(p_payload)
    || jsonb_build_object(
      'client_mutation_id', v_client_mutation_id,
      'stock_reconciled', true
    );
END;
$$;

REVOKE ALL ON FUNCTION public.process_sale(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_sale(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_sale(jsonb) TO authenticated;

-- Blocker 8: fiscal integration boundary.
--
-- The sale/payment transaction only creates the fiscal intent and immutable
-- snapshot. External providers are called by an application worker after the
-- transaction commits, using integration_outbox and stable operation keys.

ALTER TYPE public.fiscal_document_status ADD VALUE IF NOT EXISTS 'unknown';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'fiscal_operation_type'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.fiscal_operation_type AS ENUM ('issue', 'cancel', 'consult');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'integration_outbox_status'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.integration_outbox_status AS ENUM (
      'pending',
      'processing',
      'completed',
      'failed',
      'unknown'
    );
  END IF;
END
$$;

ALTER TABLE public.fiscal_documents
  ADD COLUMN IF NOT EXISTS operation_id uuid,
  ADD COLUMN IF NOT EXISTS last_operation public.fiscal_operation_type,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS unknown_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;

ALTER TABLE public.fiscal_documents
  ADD CONSTRAINT fiscal_documents_payload_object_check
  CHECK (jsonb_typeof(payload) = 'object');

ALTER TABLE public.fiscal_documents
  ADD CONSTRAINT fiscal_documents_attempt_count_check
  CHECK (attempt_count >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS fiscal_documents_id_store_org_key
  ON public.fiscal_documents (id, store_id, org_id);

CREATE TABLE IF NOT EXISTS public.integration_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  fiscal_document_id uuid NOT NULL REFERENCES public.fiscal_documents (id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  operation_type public.fiscal_operation_type NOT NULL,
  provider text NOT NULL CHECK (length(btrim(provider)) BETWEEN 1 AND 100),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 300),
  status public.integration_outbox_status NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_outbox_scope_fk
    FOREIGN KEY (fiscal_document_id, store_id, org_id)
    REFERENCES public.fiscal_documents (id, store_id, org_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS integration_outbox_operation_key
  ON public.integration_outbox (fiscal_document_id, operation_type, operation_id);

CREATE UNIQUE INDEX IF NOT EXISTS integration_outbox_idempotency_key
  ON public.integration_outbox (org_id, store_id, idempotency_key);

CREATE INDEX IF NOT EXISTS integration_outbox_due_idx
  ON public.integration_outbox (status, next_attempt_at, created_at, id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS integration_outbox_document_idx
  ON public.integration_outbox (fiscal_document_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.build_fiscal_snapshot(p_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_items jsonb;
  v_payments jsonb;
BEGIN
  SELECT *
  INTO v_sale
  FROM public.sales
  WHERE id = p_sale_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fiscal_snapshot_sale_not_found'
      USING ERRCODE = '23503';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', si.id,
        'product_id', si.product_id,
        'sku', si.product_sku,
        'name', si.product_name,
        'quantity', si.quantity,
        'unit_price', si.unit_price,
        'discount', si.discount,
        'total', si.total
      )
      ORDER BY si.id
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM public.sale_items si
  WHERE si.sale_id = p_sale_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'method', p.method,
        'amount', p.amount,
        'status', p.status
      )
      ORDER BY p.id
    ),
    '[]'::jsonb
  )
  INTO v_payments
  FROM public.payments p
  WHERE p.sale_id = p_sale_id;

  IF v_sale.customer_id IS NOT NULL THEN
    SELECT *
    INTO v_customer
    FROM public.customers
    WHERE id = v_sale.customer_id
      AND org_id = v_sale.org_id;
  END IF;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'sale', jsonb_build_object(
      'id', v_sale.id,
      'org_id', v_sale.org_id,
      'store_id', v_sale.store_id,
      'client_mutation_id', v_sale.client_mutation_id,
      'customer_id', v_sale.customer_id,
      'subtotal', v_sale.subtotal,
      'discount', v_sale.discount,
      'total', v_sale.total,
      'status', v_sale.status,
      'created_at', v_sale.created_at,
      'confirmed_at', v_sale.confirmed_at
    ),
    'customer', CASE
      WHEN v_customer.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', v_customer.id,
        'name', v_customer.name,
        'document', v_customer.document
      )
    END,
    'items', v_items,
    'payments', v_payments
  );
END;
$$;

REVOKE ALL ON FUNCTION public.build_fiscal_snapshot(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.build_fiscal_snapshot(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.build_fiscal_snapshot(uuid) FROM authenticated;

-- Backfill only the previously empty fiscal payload. Sale history itself is
-- never rebuilt or changed; the snapshot is materialized from immutable sale
-- item/payment rows and the customer data available at migration time.
UPDATE public.fiscal_documents fd
SET payload = public.build_fiscal_snapshot(fd.sale_id)
WHERE fd.payload = '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.lock_fiscal_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND (NEW.payload IS NULL OR NEW.payload = '{}'::jsonb) THEN
    NEW.payload := public.build_fiscal_snapshot(NEW.sale_id);
  ELSIF TG_OP = 'UPDATE' AND NEW.payload IS DISTINCT FROM OLD.payload THEN
    RAISE EXCEPTION 'fiscal_snapshot_immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_fiscal_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lock_fiscal_snapshot() FROM anon;
REVOKE ALL ON FUNCTION public.lock_fiscal_snapshot() FROM authenticated;

DROP TRIGGER IF EXISTS lock_fiscal_snapshot ON public.fiscal_documents;
CREATE TRIGGER lock_fiscal_snapshot
  BEFORE INSERT OR UPDATE ON public.fiscal_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_fiscal_snapshot();

CREATE OR REPLACE FUNCTION public.assert_fiscal_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_previous text := OLD.status::text;
  v_next text := NEW.status::text;
  v_allowed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_next IN ('not_configured', 'pending', 'unknown') THEN
      IF v_next = 'unknown' THEN
        NEW.unknown_at := COALESCE(NEW.unknown_at, now());
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'invalid_initial_fiscal_status'
      USING ERRCODE = '23514';
  END IF;

  IF v_previous = v_next THEN
    RETURN NEW;
  END IF;

  v_allowed := CASE v_previous
    WHEN 'not_configured' THEN v_next IN ('pending')
    WHEN 'pending' THEN v_next IN ('issued', 'failed', 'unknown', 'cancelled', 'not_configured')
    WHEN 'unknown' THEN v_next IN ('pending', 'issued', 'failed', 'cancelled', 'not_configured')
    WHEN 'failed' THEN v_next IN ('pending')
    WHEN 'cancelled' THEN v_next IN ('pending')
    WHEN 'issued' THEN v_next IN ('pending', 'cancelled')
    ELSE false
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'invalid_fiscal_status_transition'
      USING ERRCODE = '23514',
            DETAIL = format('%s -> %s', v_previous, v_next);
  END IF;

  IF v_next = 'unknown' THEN
    NEW.unknown_at := COALESCE(NEW.unknown_at, now());
  ELSE
    NEW.unknown_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_fiscal_status_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_fiscal_status_transition() FROM anon;
REVOKE ALL ON FUNCTION public.assert_fiscal_status_transition() FROM authenticated;

DROP TRIGGER IF EXISTS assert_fiscal_status_transition ON public.fiscal_documents;
CREATE TRIGGER assert_fiscal_status_transition
  BEFORE INSERT OR UPDATE OF status ON public.fiscal_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_fiscal_status_transition();

CREATE OR REPLACE FUNCTION public.set_integration_outbox_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_integration_outbox_updated_at() FROM PUBLIC;

DROP TRIGGER IF EXISTS set_integration_outbox_updated_at ON public.integration_outbox;
CREATE TRIGGER set_integration_outbox_updated_at
  BEFORE UPDATE ON public.integration_outbox
  FOR EACH ROW
  EXECUTE FUNCTION public.set_integration_outbox_updated_at();

CREATE OR REPLACE FUNCTION public.append_fiscal_audit(
  p_document_id uuid,
  p_action text,
  p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_document public.fiscal_documents%ROWTYPE;
BEGIN
  SELECT *
  INTO v_document
  FROM public.fiscal_documents
  WHERE id = p_document_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fiscal_document_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.audit_logs (
    org_id,
    store_id,
    user_id,
    entity_type,
    entity_id,
    action,
    payload
  )
  VALUES (
    v_document.org_id,
    v_document.store_id,
    (SELECT auth.uid()),
    'fiscal_document',
    v_document.id,
    p_action,
    COALESCE(p_payload, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.append_fiscal_audit(uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_fiscal_audit(uuid, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.append_fiscal_audit(uuid, text, jsonb) FROM authenticated;

CREATE OR REPLACE FUNCTION public.fiscal_result_error_code(p_payload jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT NULLIF(
    left(
      regexp_replace(
        btrim(COALESCE(p_payload->>'error_code', 'provider_error')),
        '[^a-zA-Z0-9_.:-]',
        '_',
        'g'
      ),
      120
    ),
    ''
  );
$$;

REVOKE ALL ON FUNCTION public.fiscal_result_error_code(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.request_fiscal_issue(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_sale_id uuid;
  v_provider text;
  v_operation_id uuid;
  v_sale public.sales%ROWTYPE;
  v_document public.fiscal_documents%ROWTYPE;
  v_outbox public.integration_outbox%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_fiscal_issue_request' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_sale_id := NULLIF(p_payload->>'sale_id', '')::uuid;
    v_operation_id := NULLIF(p_payload->>'operation_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_fiscal_issue_request' USING ERRCODE = '22023';
  END;
  v_provider := NULLIF(btrim(p_payload->>'provider'), '');

  IF v_store_id IS NULL OR v_sale_id IS NULL OR v_provider IS NULL THEN
    RAISE EXCEPTION 'invalid_fiscal_issue_request' USING ERRCODE = '22023';
  END IF;
  IF length(v_provider) > 100 THEN
    RAISE EXCEPTION 'invalid_fiscal_provider' USING ERRCODE = '22023';
  END IF;
  IF public.user_has_store_access(v_store_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'fiscal_access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_sale
  FROM public.sales
  WHERE id = v_sale_id
    AND store_id = v_store_id
    AND org_id = public.current_user_org_id()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fiscal_sale_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_sale.status <> 'confirmed' THEN
    RAISE EXCEPTION 'fiscal_sale_not_confirmed' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.sale_id = v_sale.id
      AND p.org_id = v_sale.org_id
      AND p.store_id = v_sale.store_id
      AND p.status = 'captured'
  ) THEN
    RAISE EXCEPTION 'fiscal_payment_not_confirmed' USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO v_document
  FROM public.fiscal_documents
  WHERE sale_id = v_sale.id
    AND org_id = v_sale.org_id
    AND store_id = v_sale.store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.fiscal_documents (
      org_id,
      store_id,
      sale_id,
      adapter,
      status,
      payload
    )
    VALUES (
      v_sale.org_id,
      v_sale.store_id,
      v_sale.id,
      'not_configured',
      'not_configured',
      public.build_fiscal_snapshot(v_sale.id)
    )
    RETURNING * INTO v_document;
  END IF;

  IF v_provider = 'not_configured' THEN
    PERFORM public.append_fiscal_audit(
      v_document.id,
      'fiscal.issue.requested',
      jsonb_build_object(
        'provider', 'not_configured',
        'status', 'not_configured',
        'operation', 'issue',
        'attempt', v_document.attempt_count
      )
    );
    RETURN jsonb_build_object(
      'fiscal_document_id', v_document.id,
      'sale_id', v_document.sale_id,
      'status', 'not_configured',
      'provider', 'not_configured',
      'replay', true,
      'outbox_id', NULL
    );
  END IF;

  IF v_document.status = 'issued' THEN
    RETURN jsonb_build_object(
      'fiscal_document_id', v_document.id,
      'sale_id', v_document.sale_id,
      'operation_id', v_document.operation_id,
      'external_id', v_document.external_id,
      'status', 'issued',
      'provider', v_document.adapter,
      'replay', true
    );
  END IF;

  IF v_operation_id IS NULL THEN
    IF v_document.status IN ('pending', 'unknown') THEN
      RAISE EXCEPTION 'fiscal_operation_pending'
        USING ERRCODE = '40901';
    ELSIF v_document.status = 'not_configured' AND v_document.operation_id IS NULL THEN
      v_operation_id := md5(v_document.id::text || ':issue')::uuid;
    ELSE
      RAISE EXCEPTION 'fiscal_operation_id_required' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT *
  INTO v_outbox
  FROM public.integration_outbox
  WHERE fiscal_document_id = v_document.id
    AND operation_type = 'issue'
    AND operation_id = v_operation_id
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'fiscal_document_id', v_document.id,
      'sale_id', v_document.sale_id,
      'operation_id', v_outbox.operation_id,
      'outbox_id', v_outbox.id,
      'status', v_document.status,
      'provider', v_outbox.provider,
      'replay', true
    );
  END IF;

  IF v_document.status IN ('pending', 'unknown') THEN
    RAISE EXCEPTION 'fiscal_operation_pending'
      USING ERRCODE = '40901';
  END IF;

  UPDATE public.fiscal_documents
  SET adapter = v_provider,
      status = 'pending',
      operation_id = v_operation_id,
      last_operation = 'issue',
      attempt_count = 0,
      last_error = NULL,
      requested_at = now(),
      unknown_at = NULL,
      reconciled_at = NULL
  WHERE id = v_document.id
  RETURNING * INTO v_document;

  INSERT INTO public.integration_outbox (
    org_id,
    store_id,
    fiscal_document_id,
    operation_id,
    operation_type,
    provider,
    idempotency_key
  )
  VALUES (
    v_document.org_id,
    v_document.store_id,
    v_document.id,
    v_operation_id,
    'issue',
    v_provider,
    'fiscal:' || v_document.id::text || ':issue:' || v_operation_id::text
  )
  RETURNING * INTO v_outbox;

  PERFORM public.append_fiscal_audit(
    v_document.id,
    'fiscal.issue.requested',
    jsonb_build_object(
      'provider', v_provider,
      'operation_id', v_operation_id,
      'outbox_id', v_outbox.id,
      'status', v_document.status,
      'attempt', 0
    )
  );

  RETURN jsonb_build_object(
    'fiscal_document_id', v_document.id,
    'sale_id', v_document.sale_id,
    'operation_id', v_operation_id,
    'outbox_id', v_outbox.id,
    'status', v_document.status,
    'provider', v_provider,
    'replay', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.request_fiscal_cancel(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_document_id uuid;
  v_sale_id uuid;
  v_operation_id uuid;
  v_provider text;
  v_document public.fiscal_documents%ROWTYPE;
  v_outbox public.integration_outbox%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_fiscal_cancel_request' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_document_id := NULLIF(p_payload->>'fiscal_document_id', '')::uuid;
    v_sale_id := NULLIF(p_payload->>'sale_id', '')::uuid;
    v_operation_id := NULLIF(p_payload->>'operation_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_fiscal_cancel_request' USING ERRCODE = '22023';
  END;
  v_provider := NULLIF(btrim(p_payload->>'provider'), '');

  IF v_store_id IS NULL OR (v_document_id IS NULL AND v_sale_id IS NULL) OR v_provider IS NULL THEN
    RAISE EXCEPTION 'invalid_fiscal_cancel_request' USING ERRCODE = '22023';
  END IF;
  IF public.user_store_role(v_store_id) NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'fiscal_cancel_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT fd.*
  INTO v_document
  FROM public.fiscal_documents fd
  WHERE fd.store_id = v_store_id
    AND fd.org_id = public.current_user_org_id()
    AND (v_document_id IS NULL OR fd.id = v_document_id)
    AND (v_sale_id IS NULL OR fd.sale_id = v_sale_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fiscal_document_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_provider = 'not_configured' THEN
    PERFORM public.append_fiscal_audit(
      v_document.id,
      'fiscal.cancel.requested',
      jsonb_build_object(
        'provider', 'not_configured',
        'status', 'not_configured',
        'operation', 'cancel'
      )
    );
    RETURN jsonb_build_object(
      'fiscal_document_id', v_document.id,
      'sale_id', v_document.sale_id,
      'status', 'not_configured',
      'provider', 'not_configured',
      'replay', true
    );
  END IF;

  IF v_document.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'fiscal_document_id', v_document.id,
      'sale_id', v_document.sale_id,
      'status', 'cancelled',
      'provider', v_document.adapter,
      'replay', true
    );
  END IF;
  IF v_document.status <> 'issued' THEN
    RAISE EXCEPTION 'fiscal_cancel_requires_issued'
      USING ERRCODE = '23514';
  END IF;

  v_operation_id := COALESCE(
    v_operation_id,
    md5(v_document.id::text || ':cancel')::uuid
  );

  SELECT *
  INTO v_outbox
  FROM public.integration_outbox
  WHERE fiscal_document_id = v_document.id
    AND operation_type = 'cancel'
    AND operation_id = v_operation_id
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'fiscal_document_id', v_document.id,
      'sale_id', v_document.sale_id,
      'operation_id', v_outbox.operation_id,
      'outbox_id', v_outbox.id,
      'status', v_document.status,
      'provider', v_outbox.provider,
      'replay', true
    );
  END IF;

  UPDATE public.fiscal_documents
  SET adapter = v_provider,
      status = 'pending',
      operation_id = v_operation_id,
      last_operation = 'cancel',
      attempt_count = 0,
      last_error = NULL,
      requested_at = now(),
      unknown_at = NULL
  WHERE id = v_document.id
  RETURNING * INTO v_document;

  INSERT INTO public.integration_outbox (
    org_id,
    store_id,
    fiscal_document_id,
    operation_id,
    operation_type,
    provider,
    idempotency_key
  )
  VALUES (
    v_document.org_id,
    v_document.store_id,
    v_document.id,
    v_operation_id,
    'cancel',
    v_provider,
    'fiscal:' || v_document.id::text || ':cancel:' || v_operation_id::text
  )
  RETURNING * INTO v_outbox;

  PERFORM public.append_fiscal_audit(
    v_document.id,
    'fiscal.cancel.requested',
    jsonb_build_object(
      'provider', v_provider,
      'operation_id', v_operation_id,
      'outbox_id', v_outbox.id,
      'status', v_document.status,
      'attempt', 0
    )
  );

  RETURN jsonb_build_object(
    'fiscal_document_id', v_document.id,
    'sale_id', v_document.sale_id,
    'operation_id', v_operation_id,
    'outbox_id', v_outbox.id,
    'status', v_document.status,
    'provider', v_provider,
    'replay', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.request_fiscal_reconcile(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_store_id uuid;
  v_document_id uuid;
  v_sale_id uuid;
  v_document public.fiscal_documents%ROWTYPE;
  v_outbox public.integration_outbox%ROWTYPE;
  v_operation_id uuid;
  v_provider text;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_fiscal_reconciliation' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_document_id := NULLIF(p_payload->>'fiscal_document_id', '')::uuid;
    v_sale_id := NULLIF(p_payload->>'sale_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_fiscal_reconciliation' USING ERRCODE = '22023';
  END;

  IF v_store_id IS NULL OR (v_document_id IS NULL AND v_sale_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_fiscal_reconciliation' USING ERRCODE = '22023';
  END IF;
  IF public.user_has_store_access(v_store_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'fiscal_access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT fd.*
  INTO v_document
  FROM public.fiscal_documents fd
  WHERE fd.store_id = v_store_id
    AND fd.org_id = public.current_user_org_id()
    AND (v_document_id IS NULL OR fd.id = v_document_id)
    AND (v_sale_id IS NULL OR fd.sale_id = v_sale_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fiscal_document_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_document.status <> 'unknown' THEN
    RETURN jsonb_build_object(
      'fiscal_document_id', v_document.id,
      'sale_id', v_document.sale_id,
      'status', v_document.status,
      'provider', v_document.adapter,
      'replay', true,
      'reconciled', false
    );
  END IF;

  v_provider := NULLIF(btrim(v_document.adapter), '');
  IF v_provider IS NULL OR v_provider = 'not_configured' THEN
    RETURN jsonb_build_object(
      'fiscal_document_id', v_document.id,
      'sale_id', v_document.sale_id,
      'status', 'not_configured',
      'provider', 'not_configured',
      'replay', true,
      'reconciled', false
    );
  END IF;

  v_operation_id := md5(
    v_document.id::text || ':consult:' || COALESCE(v_document.operation_id::text, '')
  )::uuid;

  SELECT *
  INTO v_outbox
  FROM public.integration_outbox
  WHERE fiscal_document_id = v_document.id
    AND operation_type = 'consult'
    AND operation_id = v_operation_id
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'fiscal_document_id', v_document.id,
      'sale_id', v_document.sale_id,
      'operation_id', v_outbox.operation_id,
      'outbox_id', v_outbox.id,
      'status', v_document.status,
      'provider', v_outbox.provider,
      'replay', true,
      'reconciled', false
    );
  END IF;

  UPDATE public.fiscal_documents
  SET status = 'pending',
      operation_id = v_operation_id,
      last_operation = 'consult',
      attempt_count = 0,
      last_error = NULL,
      requested_at = now()
  WHERE id = v_document.id
  RETURNING * INTO v_document;

  INSERT INTO public.integration_outbox (
    org_id,
    store_id,
    fiscal_document_id,
    operation_id,
    operation_type,
    provider,
    idempotency_key
  )
  VALUES (
    v_document.org_id,
    v_document.store_id,
    v_document.id,
    v_operation_id,
    'consult',
    v_provider,
    'fiscal:' || v_document.id::text || ':consult:' || v_operation_id::text
  )
  RETURNING * INTO v_outbox;

  PERFORM public.append_fiscal_audit(
    v_document.id,
    'fiscal.reconcile',
    jsonb_build_object(
      'provider', v_provider,
      'operation_id', v_operation_id,
      'outbox_id', v_outbox.id,
      'from_status', 'unknown',
      'status', v_document.status,
      'attempt', 0
    )
  );

  RETURN jsonb_build_object(
    'fiscal_document_id', v_document.id,
    'sale_id', v_document.sale_id,
    'operation_id', v_operation_id,
    'outbox_id', v_outbox.id,
    'status', v_document.status,
    'provider', v_provider,
    'replay', false,
    'reconciled', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_fiscal_operation(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_store_id uuid;
  v_document_id uuid;
  v_operation_id uuid;
  v_document public.fiscal_documents%ROWTYPE;
  v_outbox public.integration_outbox%ROWTYPE;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_document_id := NULLIF(p_payload->>'fiscal_document_id', '')::uuid;
    v_operation_id := NULLIF(p_payload->>'operation_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_fiscal_retry' USING ERRCODE = '22023';
  END;
  IF v_store_id IS NULL OR v_document_id IS NULL THEN
    RAISE EXCEPTION 'invalid_fiscal_retry' USING ERRCODE = '22023';
  END IF;
  IF public.user_has_store_access(v_store_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'fiscal_access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_document
  FROM public.fiscal_documents
  WHERE id = v_document_id
    AND store_id = v_store_id
    AND org_id = public.current_user_org_id()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fiscal_document_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_document.status = 'unknown' THEN
    RAISE EXCEPTION 'fiscal_reconciliation_required' USING ERRCODE = '40901';
  END IF;
  IF v_document.last_operation IS NULL THEN
    RAISE EXCEPTION 'fiscal_operation_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_outbox
  FROM public.integration_outbox
  WHERE fiscal_document_id = v_document.id
    AND operation_type = v_document.last_operation
    AND (v_operation_id IS NULL OR operation_id = v_operation_id)
  ORDER BY created_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fiscal_operation_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_outbox.status = 'unknown' THEN
    RAISE EXCEPTION 'fiscal_reconciliation_required' USING ERRCODE = '40901';
  END IF;
  IF v_outbox.status = 'completed' THEN
    RETURN jsonb_build_object(
      'fiscal_document_id', v_document.id,
      'sale_id', v_document.sale_id,
      'operation_id', v_outbox.operation_id,
      'outbox_id', v_outbox.id,
      'status', v_document.status,
      'provider', v_outbox.provider,
      'replay', true
    );
  END IF;

  UPDATE public.fiscal_documents
  SET status = 'pending',
      last_error = NULL,
      requested_at = now()
  WHERE id = v_document.id
  RETURNING * INTO v_document;

  UPDATE public.integration_outbox
  SET status = 'pending',
      next_attempt_at = now(),
      last_error = NULL
  WHERE id = v_outbox.id
  RETURNING * INTO v_outbox;

  PERFORM public.append_fiscal_audit(
    v_document.id,
    CASE v_outbox.operation_type
      WHEN 'issue' THEN 'fiscal.issue.requested'
      WHEN 'cancel' THEN 'fiscal.cancel.requested'
      ELSE 'fiscal.reconcile'
    END,
    jsonb_build_object(
      'provider', v_outbox.provider,
      'operation_id', v_outbox.operation_id,
      'outbox_id', v_outbox.id,
      'status', v_document.status,
      'retry', true,
      'attempt', v_outbox.attempt_count
    )
  );

  RETURN jsonb_build_object(
    'fiscal_document_id', v_document.id,
    'sale_id', v_document.sale_id,
    'operation_id', v_outbox.operation_id,
    'outbox_id', v_outbox.id,
    'status', v_document.status,
    'provider', v_outbox.provider,
    'replay', false,
    'retry', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_fiscal_outbox(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE((p_payload->>'limit')::integer, 10), 1), 50);
  v_document_id uuid := NULLIF(p_payload->>'fiscal_document_id', '')::uuid;
  v_outbox public.integration_outbox%ROWTYPE;
  v_document public.fiscal_documents%ROWTYPE;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  FOR v_outbox IN
    SELECT o.*
    FROM public.integration_outbox o
    WHERE o.status = 'pending'
      AND o.next_attempt_at <= now()
      AND (v_document_id IS NULL OR o.fiscal_document_id = v_document_id)
    ORDER BY o.next_attempt_at, o.created_at, o.id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT *
    INTO v_document
    FROM public.fiscal_documents
    WHERE id = v_outbox.fiscal_document_id
    FOR SHARE;

    UPDATE public.integration_outbox
    SET status = 'processing',
        attempt_count = attempt_count + 1,
        last_error = NULL
    WHERE id = v_outbox.id
    RETURNING * INTO v_outbox;

    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object(
        'outbox_id', v_outbox.id,
        'fiscal_document_id', v_document.id,
        'sale_id', v_document.sale_id,
        'org_id', v_document.org_id,
        'store_id', v_document.store_id,
        'operation_id', v_outbox.operation_id,
        'operation_type', v_outbox.operation_type,
        'provider', v_outbox.provider,
        'idempotency_key', v_outbox.idempotency_key,
        'attempt', v_outbox.attempt_count,
        'snapshot', v_document.payload,
        'external_id', v_document.external_id,
        'status', v_document.status
      )
    );
  END LOOP;

  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_fiscal_result(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_outbox_id uuid;
  v_operation_id uuid;
  v_result_status text;
  v_provider text;
  v_external_id text;
  v_error_code text;
  v_outbox public.integration_outbox%ROWTYPE;
  v_document public.fiscal_documents%ROWTYPE;
  v_next_document_status public.fiscal_document_status;
  v_next_outbox_status public.integration_outbox_status;
  v_action text;
  v_replay boolean := false;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_fiscal_result' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_outbox_id := NULLIF(p_payload->>'outbox_id', '')::uuid;
    v_operation_id := NULLIF(p_payload->>'operation_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_fiscal_result' USING ERRCODE = '22023';
  END;
  v_result_status := lower(NULLIF(btrim(p_payload->>'status'), ''));
  v_provider := NULLIF(btrim(p_payload->>'provider'), '');
  v_external_id := NULLIF(btrim(p_payload->>'external_id'), '');
  v_error_code := public.fiscal_result_error_code(p_payload);

  IF (v_outbox_id IS NULL AND v_operation_id IS NULL)
    OR v_result_status IS NULL
    OR v_result_status NOT IN ('issued', 'failed', 'pending', 'unknown', 'cancelled', 'not_configured')
  THEN
    RAISE EXCEPTION 'invalid_fiscal_result' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_outbox
  FROM public.integration_outbox
  WHERE (v_outbox_id IS NULL OR id = v_outbox_id)
    AND (v_operation_id IS NULL OR operation_id = v_operation_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fiscal_operation_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_document
  FROM public.fiscal_documents
  WHERE id = v_outbox.fiscal_document_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fiscal_document_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_provider IS NOT NULL AND v_provider <> v_outbox.provider THEN
    RAISE EXCEPTION 'fiscal_provider_mismatch' USING ERRCODE = '22023';
  END IF;

  IF v_outbox.status IN ('completed', 'failed')
    OR (v_outbox.status = 'unknown' AND v_result_status NOT IN ('issued', 'failed', 'cancelled'))
  THEN
    v_replay := true;
    RETURN jsonb_build_object(
      'fiscal_document_id', v_document.id,
      'sale_id', v_document.sale_id,
      'outbox_id', v_outbox.id,
      'operation_id', v_outbox.operation_id,
      'status', v_document.status,
      'provider', v_outbox.provider,
      'external_id', v_document.external_id,
      'attempt', v_outbox.attempt_count,
      'replay', v_replay
    );
  END IF;

  IF v_result_status = 'issued' THEN
    IF v_outbox.operation_type NOT IN ('issue', 'consult')
      OR v_document.status IN ('failed', 'cancelled', 'not_configured')
    THEN
      RAISE EXCEPTION 'invalid_fiscal_result_transition'
        USING ERRCODE = '23514';
    END IF;
    v_next_document_status := 'issued';
    v_next_outbox_status := 'completed';
  ELSIF v_result_status = 'cancelled' THEN
    IF v_outbox.operation_type NOT IN ('cancel', 'consult')
      OR v_document.status = 'not_configured'
    THEN
      RAISE EXCEPTION 'invalid_fiscal_result_transition'
        USING ERRCODE = '23514';
    END IF;
    v_next_document_status := 'cancelled';
    v_next_outbox_status := 'completed';
  ELSIF v_result_status = 'failed' THEN
    v_next_document_status := 'failed';
    v_next_outbox_status := 'failed';
  ELSIF v_result_status = 'unknown' THEN
    v_next_document_status := 'unknown';
    v_next_outbox_status := 'unknown';
  ELSIF v_result_status = 'not_configured' THEN
    v_next_document_status := 'not_configured';
    v_next_outbox_status := 'failed';
  ELSE
    v_next_document_status := 'pending';
    v_next_outbox_status := 'pending';
  END IF;

  IF v_document.status = v_next_document_status
    AND v_outbox.status = v_next_outbox_status
  THEN
    v_replay := true;
  ELSE
    UPDATE public.fiscal_documents
    SET status = v_next_document_status,
        external_id = COALESCE(v_external_id, external_id),
        last_error = CASE
          WHEN v_next_document_status IN ('failed', 'unknown') THEN v_error_code
          ELSE NULL
        END,
        attempt_count = v_outbox.attempt_count,
        unknown_at = CASE
          WHEN v_next_document_status = 'unknown' THEN COALESCE(unknown_at, now())
          ELSE NULL
        END,
        issued_at = CASE
          WHEN v_next_document_status = 'issued' THEN COALESCE(issued_at, now())
          ELSE issued_at
        END,
        cancelled_at = CASE
          WHEN v_next_document_status = 'cancelled' THEN COALESCE(cancelled_at, now())
          ELSE cancelled_at
        END,
        reconciled_at = CASE
          WHEN v_outbox.operation_type = 'consult'
            AND v_next_document_status IN ('issued', 'failed', 'cancelled')
            THEN now()
          ELSE reconciled_at
        END
    WHERE id = v_document.id
    RETURNING * INTO v_document;

    UPDATE public.integration_outbox
    SET status = v_next_outbox_status,
        last_error = CASE
          WHEN v_next_outbox_status IN ('failed', 'unknown') THEN v_error_code
          ELSE NULL
        END,
        next_attempt_at = CASE
          WHEN v_next_outbox_status = 'pending'
            THEN now() + make_interval(secs => LEAST(300, GREATEST(5, v_outbox.attempt_count * 5)))
          ELSE next_attempt_at
        END
    WHERE id = v_outbox.id
    RETURNING * INTO v_outbox;

    v_action := CASE
      WHEN v_outbox.operation_type = 'issue' AND v_next_document_status = 'issued'
        THEN 'fiscal.issue.issued'
      WHEN v_outbox.operation_type = 'issue' AND v_next_document_status = 'failed'
        THEN 'fiscal.issue.failed'
      WHEN v_outbox.operation_type = 'issue' AND v_next_document_status = 'unknown'
        THEN 'fiscal.issue.unknown'
      WHEN v_outbox.operation_type = 'cancel' AND v_next_document_status = 'cancelled'
        THEN 'fiscal.cancelled'
      WHEN v_outbox.operation_type = 'cancel' AND v_next_document_status = 'failed'
        THEN 'fiscal.cancel.failed'
      WHEN v_outbox.operation_type = 'cancel' AND v_next_document_status = 'unknown'
        THEN 'fiscal.cancel.unknown'
      WHEN v_outbox.operation_type = 'consult'
        THEN 'fiscal.reconcile'
      ELSE NULL
    END;

    IF v_action IS NOT NULL THEN
      PERFORM public.append_fiscal_audit(
        v_document.id,
        v_action,
        jsonb_build_object(
          'provider', v_outbox.provider,
          'operation_id', v_outbox.operation_id,
          'outbox_id', v_outbox.id,
          'operation', v_outbox.operation_type,
          'status', v_document.status,
          'attempt', v_outbox.attempt_count,
          'external_id', v_document.external_id,
          'error_code', CASE
            WHEN v_document.status IN ('failed', 'unknown') THEN v_error_code
            ELSE NULL
          END
        )
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'fiscal_document_id', v_document.id,
    'sale_id', v_document.sale_id,
    'outbox_id', v_outbox.id,
    'operation_id', v_outbox.operation_id,
    'status', v_document.status,
    'provider', v_outbox.provider,
    'external_id', v_document.external_id,
    'error_code', v_document.last_error,
    'attempt', v_outbox.attempt_count,
    'replay', v_replay,
    'reconciled', v_outbox.operation_type = 'consult'
      AND v_document.status IN ('issued', 'failed', 'cancelled')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_fiscal_issue(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_fiscal_issue(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_fiscal_issue(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.request_fiscal_cancel(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_fiscal_cancel(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_fiscal_cancel(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.request_fiscal_reconcile(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_fiscal_reconcile(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_fiscal_reconcile(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.retry_fiscal_operation(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.retry_fiscal_operation(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.retry_fiscal_operation(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.claim_fiscal_outbox(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_fiscal_outbox(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.claim_fiscal_outbox(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_fiscal_outbox(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.record_fiscal_result(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_fiscal_result(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.record_fiscal_result(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_fiscal_result(jsonb) TO service_role;

ALTER TABLE public.integration_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integration_outbox_deny ON public.integration_outbox;
CREATE POLICY integration_outbox_deny
  ON public.integration_outbox
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.integration_outbox FROM PUBLIC;
REVOKE ALL ON TABLE public.integration_outbox FROM anon;
REVOKE ALL ON TABLE public.integration_outbox FROM authenticated;
REVOKE ALL ON TABLE public.integration_outbox FROM service_role;

REVOKE INSERT, UPDATE, DELETE ON public.fiscal_documents FROM service_role;
REVOKE INSERT, UPDATE, DELETE ON public.fiscal_documents FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.fiscal_documents FROM anon;

-- Keep the browser read-only and store scoped. The existing policy is
-- replaced explicitly so later hardening cannot accidentally widen it.
DROP POLICY IF EXISTS fiscal_documents_store_select ON public.fiscal_documents;
DROP POLICY IF EXISTS fiscal_documents_select ON public.fiscal_documents;
CREATE POLICY fiscal_documents_store_select
  ON public.fiscal_documents
  FOR SELECT
  TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_has_store_access(store_id) IS TRUE
  );

-- Blocker 6: server-authoritative suspended sales.
-- Suspended rows are deliberately separate from public.sales: a suspended
-- snapshot has no payment, inventory movement, fiscal document or cash entry.

DO $$
BEGIN
  CREATE TYPE public.suspended_sale_status AS ENUM (
    'suspended',
    'claimed',
    'completed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE public.suspended_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  operator_id uuid NOT NULL REFERENCES auth.users (id),
  terminal_id uuid NOT NULL,
  status public.suspended_sale_status NOT NULL DEFAULT 'suspended',
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  snapshot_version integer NOT NULL DEFAULT 1 CHECK (snapshot_version = 1),
  subtotal numeric(12, 2) NOT NULL CHECK (subtotal >= 0),
  discount numeric(12, 2) NOT NULL CHECK (discount >= 0),
  total numeric(12, 2) NOT NULL CHECK (total >= 0),
  customer_id uuid REFERENCES public.customers (id) ON DELETE SET NULL,
  client_mutation_id uuid NOT NULL,
  claimed_by uuid REFERENCES auth.users (id),
  claimed_at timestamptz,
  claim_id uuid,
  claimed_terminal_id uuid,
  recovery_client_mutation_id uuid,
  completed_at timestamptz,
  completed_sale_id uuid,
  completion_client_mutation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suspended_sales_state_check CHECK (
    (
      status = 'suspended'
      AND claimed_by IS NULL
      AND claimed_at IS NULL
      AND claim_id IS NULL
      AND claimed_terminal_id IS NULL
      AND recovery_client_mutation_id IS NULL
      AND completed_at IS NULL
      AND completed_sale_id IS NULL
      AND completion_client_mutation_id IS NULL
    )
    OR (
      status = 'claimed'
      AND claimed_by IS NOT NULL
      AND claimed_at IS NOT NULL
      AND claim_id IS NOT NULL
      AND claimed_terminal_id IS NOT NULL
      AND recovery_client_mutation_id IS NOT NULL
      AND completed_at IS NULL
      AND completed_sale_id IS NULL
      AND completion_client_mutation_id IS NULL
    )
    OR (
      status = 'completed'
      AND claimed_by IS NOT NULL
      AND claimed_at IS NOT NULL
      AND claim_id IS NOT NULL
      AND claimed_terminal_id IS NOT NULL
      AND recovery_client_mutation_id IS NOT NULL
      AND completed_at IS NOT NULL
      AND completed_sale_id IS NOT NULL
      AND completion_client_mutation_id IS NOT NULL
    )
  ),
  CONSTRAINT suspended_sales_store_scope_fk
    FOREIGN KEY (store_id, org_id)
    REFERENCES public.stores (id, org_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX suspended_sales_store_mutation_key
  ON public.suspended_sales (store_id, client_mutation_id);

CREATE UNIQUE INDEX suspended_sales_claim_key
  ON public.suspended_sales (claim_id)
  WHERE claim_id IS NOT NULL;

CREATE UNIQUE INDEX suspended_sales_recovery_mutation_key
  ON public.suspended_sales (store_id, recovery_client_mutation_id)
  WHERE recovery_client_mutation_id IS NOT NULL;

CREATE UNIQUE INDEX suspended_sales_completion_mutation_key
  ON public.suspended_sales (store_id, completion_client_mutation_id)
  WHERE completion_client_mutation_id IS NOT NULL;

CREATE INDEX suspended_sales_store_status_created_key
  ON public.suspended_sales (org_id, store_id, status, created_at DESC, id DESC);

CREATE INDEX suspended_sales_store_terminal_created_key
  ON public.suspended_sales (org_id, store_id, terminal_id, created_at DESC, id DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'suspended_sales_completed_sale_scope_fk'
      AND conrelid = 'public.suspended_sales'::regclass
  ) THEN
    ALTER TABLE public.suspended_sales
      ADD CONSTRAINT suspended_sales_completed_sale_scope_fk
      FOREIGN KEY (completed_sale_id, org_id, store_id)
      REFERENCES public.sales (id, org_id, store_id);
  END IF;
END
$$;

DROP TRIGGER IF EXISTS suspended_sales_set_updated_at ON public.suspended_sales;
CREATE TRIGGER suspended_sales_set_updated_at
  BEFORE UPDATE ON public.suspended_sales
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.suspended_sales ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.suspended_sales FROM anon, authenticated;
GRANT SELECT ON TABLE public.suspended_sales TO authenticated;

CREATE POLICY suspended_sales_select
  ON public.suspended_sales
  FOR SELECT
  TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_has_store_access(store_id) IS TRUE
  );

CREATE OR REPLACE FUNCTION public.suspend_sale(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_org_id uuid;
  v_client_mutation_id uuid;
  v_terminal_id uuid;
  v_customer_id uuid;
  v_customer_name text;
  v_notes text;
  v_discount numeric(12, 2) := 0;
  v_gross_subtotal numeric(12, 2) := 0;
  v_item_discount_total numeric(12, 2) := 0;
  v_subtotal numeric(12, 2) := 0;
  v_total numeric(12, 2);
  v_item jsonb;
  v_product public.products%ROWTYPE;
  v_product_id uuid;
  v_qty numeric(12, 3);
  v_unit_price numeric(12, 2);
  v_item_discount numeric(12, 2);
  v_item_total numeric(12, 2);
  v_request_items jsonb := '[]'::jsonb;
  v_snapshot_items jsonb := '[]'::jsonb;
  v_snapshot jsonb;
  v_existing public.suspended_sales%ROWTYPE;
  v_suspended public.suspended_sales%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF v_user_id IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_suspended_sale_payload' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_client_mutation_id := NULLIF(p_payload->>'client_mutation_id', '')::uuid;
    v_terminal_id := NULLIF(p_payload->>'terminal_id', '')::uuid;
    v_customer_id := NULLIF(p_payload->>'customer_id', '')::uuid;
    v_discount := COALESCE(NULLIF(p_payload->>'discount', '')::numeric, 0)::numeric(12, 2);
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_suspended_sale_payload' USING ERRCODE = '22023';
  END;

  IF p_payload ? 'org_id'
    AND NULLIF(p_payload->>'org_id', '')::uuid IS DISTINCT FROM public.current_user_org_id()
  THEN
    RAISE EXCEPTION 'suspended_sale_scope_mismatch' USING ERRCODE = '42501';
  END IF;

  v_notes := NULLIF(btrim(p_payload->>'notes'), '');
  IF v_store_id IS NULL
    OR v_client_mutation_id IS NULL
    OR v_terminal_id IS NULL
    OR v_discount < 0
    OR v_notes IS NOT NULL AND length(v_notes) > 500
    OR jsonb_typeof(p_payload->'items') <> 'array'
    OR jsonb_array_length(p_payload->'items') = 0
  THEN
    RAISE EXCEPTION 'invalid_suspended_sale_payload' USING ERRCODE = '22023';
  END IF;

  SELECT s.org_id
  INTO v_org_id
  FROM public.stores s
  WHERE s.id = v_store_id
    AND s.is_active IS TRUE;

  IF v_org_id IS NULL
    OR v_org_id IS DISTINCT FROM public.current_user_org_id()
    OR public.user_store_role(v_store_id) IS NULL
  THEN
    RAISE EXCEPTION 'forbidden_suspended_sale' USING ERRCODE = '42501';
  END IF;

  IF v_customer_id IS NOT NULL THEN
    SELECT c.name
    INTO v_customer_name
    FROM public.customers c
    WHERE c.id = v_customer_id
      AND c.org_id = v_org_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'customer_not_found' USING ERRCODE = '22023';
    END IF;
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_payload->'items') AS item(value)
  LOOP
    IF jsonb_typeof(v_item->'product_id') <> 'string'
      OR jsonb_typeof(v_item->'quantity') <> 'number'
      OR jsonb_typeof(v_item->'unit_price') <> 'string'
      OR (v_item ? 'discount' AND jsonb_typeof(v_item->'discount') <> 'string')
      OR (v_item->>'unit_price') !~ '^(0|[1-9][0-9]{0,9})\.[0-9]{2}$'
      OR (
        v_item ? 'discount'
        AND (v_item->>'discount') !~ '^(0|[1-9][0-9]{0,9})\.[0-9]{2}$'
      )
    THEN
      RAISE EXCEPTION 'invalid_suspended_sale_item' USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_product_id := (v_item->>'product_id')::uuid;
      v_qty := (v_item->>'quantity')::numeric(12, 3);
      v_unit_price := (v_item->>'unit_price')::numeric(12, 2);
      v_item_discount := COALESCE(NULLIF(v_item->>'discount', '')::numeric, 0)::numeric(12, 2);
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'invalid_suspended_sale_item' USING ERRCODE = '22023';
    END;

    IF v_qty <= 0
      OR v_qty > 999999999.999
      OR v_qty <> round(v_qty, 3)
      OR v_item_discount < 0
    THEN
      RAISE EXCEPTION 'invalid_suspended_sale_item' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_request_items) AS existing_item(value)
      WHERE existing_item.value->>'product_id' = v_product_id::text
    ) THEN
      RAISE EXCEPTION 'duplicate_product' USING ERRCODE = '22023';
    END IF;

    v_request_items := v_request_items || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product_id::text,
        'quantity', to_char(v_qty, 'FM9999999990.000'),
        'unit_price', to_char(v_unit_price, 'FM9999999990.00'),
        'discount', to_char(v_item_discount, 'FM9999999990.00')
      )
    );
  END LOOP;

  SELECT COALESCE(jsonb_agg(value ORDER BY value->>'product_id'), '[]'::jsonb)
  INTO v_request_items
  FROM jsonb_array_elements(v_request_items) AS item(value);

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      v_org_id::text || ':' || v_store_id::text || ':suspend:' || v_client_mutation_id::text,
      0
    )
  );

  SELECT *
  INTO v_existing
  FROM public.suspended_sales ss
  WHERE ss.store_id = v_store_id
    AND ss.client_mutation_id = v_client_mutation_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.terminal_id IS DISTINCT FROM v_terminal_id
      OR v_existing.snapshot->'request_items' IS DISTINCT FROM v_request_items
      OR v_existing.snapshot->>'discount' IS DISTINCT FROM to_char(v_discount, 'FM9999999990.00')
      OR v_existing.snapshot->>'customer_id' IS DISTINCT FROM v_customer_id::text
      OR v_existing.snapshot->>'notes' IS DISTINCT FROM v_notes
    THEN
      RAISE EXCEPTION 'idempotency_payload_mismatch' USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'suspended_sale_id', v_existing.id,
      'client_mutation_id', v_existing.client_mutation_id,
      'status', v_existing.status,
      'total', v_existing.total::text,
      'created_at', v_existing.created_at::text,
      'replay', true
    );
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_payload->'items') AS item(value)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric(12, 3);
    v_unit_price := (v_item->>'unit_price')::numeric(12, 2);
    v_item_discount := COALESCE(NULLIF(v_item->>'discount', '')::numeric, 0)::numeric(12, 2);

    SELECT *
    INTO v_product
    FROM public.products p
    WHERE p.id = v_product_id
      AND p.org_id = v_org_id
      AND p.is_active IS TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_found' USING ERRCODE = '22023';
    END IF;
    IF v_product.unit_price IS DISTINCT FROM v_unit_price THEN
      RAISE EXCEPTION 'price_mismatch' USING ERRCODE = '22023';
    END IF;

    v_item_total := round(v_qty * v_unit_price - v_item_discount, 2);
    IF v_item_total < 0 THEN
      RAISE EXCEPTION 'invalid_item_total' USING ERRCODE = '22023';
    END IF;

    v_gross_subtotal := v_gross_subtotal + round(v_qty * v_unit_price, 2);
    v_item_discount_total := v_item_discount_total + v_item_discount;
    v_subtotal := v_subtotal + v_item_total;
    v_snapshot_items := v_snapshot_items || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product.id::text,
        'sku', v_product.sku,
        'name', v_product.name,
        'quantity', to_char(v_qty, 'FM9999999990.000'),
        'unit_price', to_char(v_unit_price, 'FM9999999990.00'),
        'discount', to_char(v_item_discount, 'FM9999999990.00'),
        'total', to_char(v_item_total, 'FM9999999990.00')
      )
    );
  END LOOP;

  SELECT COALESCE(jsonb_agg(value ORDER BY value->>'product_id'), '[]'::jsonb)
  INTO v_snapshot_items
  FROM jsonb_array_elements(v_snapshot_items) AS item(value);

  PERFORM public.assert_sale_discount_cap(
    v_store_id,
    v_discount + v_item_discount_total,
    v_gross_subtotal
  );

  v_total := round(v_subtotal - v_discount, 2);
  IF v_total < 0 THEN
    RAISE EXCEPTION 'invalid_total' USING ERRCODE = '22023';
  END IF;

  v_snapshot := jsonb_build_object(
    'version', 1,
    'org_id', v_org_id::text,
    'store_id', v_store_id::text,
    'operator_id', v_user_id::text,
    'terminal_id', v_terminal_id::text,
    'client_mutation_id', v_client_mutation_id::text,
    'request_items', v_request_items,
    'items', v_snapshot_items,
    'subtotal', to_char(v_subtotal, 'FM9999999990.00'),
    'discount', to_char(v_discount, 'FM9999999990.00'),
    'total', to_char(v_total, 'FM9999999990.00'),
    'customer_id', v_customer_id::text,
    'customer_name', v_customer_name,
    'notes', v_notes,
    'created_at', v_now::text
  );

  INSERT INTO public.suspended_sales (
    org_id,
    store_id,
    operator_id,
    terminal_id,
    snapshot,
    subtotal,
    discount,
    total,
    customer_id,
    client_mutation_id
  )
  VALUES (
    v_org_id,
    v_store_id,
    v_user_id,
    v_terminal_id,
    v_snapshot,
    v_subtotal,
    v_discount,
    v_total,
    v_customer_id,
    v_client_mutation_id
  )
  RETURNING *
  INTO v_suspended;

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
    v_org_id,
    v_store_id,
    v_user_id,
    'suspended_sale',
    v_suspended.id,
    'sale.suspended',
    jsonb_build_object(
      'client_mutation_id', v_client_mutation_id,
      'terminal_id', v_terminal_id,
      'items_count', jsonb_array_length(v_snapshot_items),
      'total', v_total
    )
  );

  RETURN jsonb_build_object(
    'suspended_sale_id', v_suspended.id,
    'client_mutation_id', v_suspended.client_mutation_id,
    'status', v_suspended.status,
    'total', v_suspended.total::text,
    'created_at', v_suspended.created_at::text,
    'replay', false
  );
END
$$;

CREATE OR REPLACE FUNCTION public.list_suspended_sales(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_terminal_id uuid;
  v_after_id uuid;
  v_after_created_at timestamptz;
  v_limit integer;
  v_org_id uuid;
  v_rows jsonb;
  v_trimmed jsonb;
  v_next_cursor jsonb := NULL;
  v_has_more boolean := false;
BEGIN
  IF v_user_id IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_suspended_sale_query' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_terminal_id := NULLIF(p_payload->>'terminal_id', '')::uuid;
    v_after_id := NULLIF(p_payload->>'after_id', '')::uuid;
    v_after_created_at := NULLIF(p_payload->>'after_created_at', '')::timestamptz;
    v_limit := LEAST(GREATEST(COALESCE((p_payload->>'limit')::integer, 20), 1), 100);
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_suspended_sale_query' USING ERRCODE = '22023';
  END;

  SELECT s.org_id
  INTO v_org_id
  FROM public.stores s
  WHERE s.id = v_store_id
    AND s.is_active IS TRUE;

  IF v_org_id IS NULL
    OR v_org_id IS DISTINCT FROM public.current_user_org_id()
    OR public.user_store_role(v_store_id) IS NULL
  THEN
    RAISE EXCEPTION 'forbidden_suspended_sale' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(rows) ORDER BY rows.created_at DESC, rows.suspended_sale_id DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      ss.id AS suspended_sale_id,
      ss.status,
      ss.operator_id,
      ss.terminal_id,
      ss.customer_id,
      ss.snapshot->>'customer_name' AS customer_name,
      jsonb_array_length(COALESCE(ss.snapshot->'items', '[]'::jsonb)) AS item_count,
      ss.subtotal::text AS subtotal,
      ss.discount::text AS discount,
      ss.total::text AS total,
      ss.created_at,
      ss.updated_at,
      ss.claimed_at
    FROM public.suspended_sales ss
    WHERE ss.org_id = v_org_id
      AND ss.store_id = v_store_id
      AND ss.status <> 'completed'
      AND (v_terminal_id IS NULL OR ss.terminal_id = v_terminal_id)
      AND (
        v_after_id IS NULL
        OR v_after_created_at IS NULL
        OR (ss.created_at, ss.id) < (v_after_created_at, v_after_id)
      )
    ORDER BY ss.created_at DESC, ss.id DESC
    LIMIT v_limit + 1
  ) rows;

  v_has_more := jsonb_array_length(v_rows) > v_limit;
  IF v_has_more THEN
    v_next_cursor := jsonb_build_object(
      'after_created_at', v_rows->(v_limit - 1)->>'created_at',
      'after_id', v_rows->(v_limit - 1)->>'suspended_sale_id'
    );
    SELECT COALESCE(jsonb_agg(value ORDER BY ordinality), '[]'::jsonb)
    INTO v_trimmed
    FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS page(value, ordinality)
    WHERE ordinality <= v_limit;
  ELSE
    v_trimmed := v_rows;
  END IF;

  RETURN jsonb_build_object(
    'rows', v_trimmed,
    'has_more', v_has_more,
    'next_cursor', v_next_cursor
  );
END
$$;

CREATE OR REPLACE FUNCTION public.recover_suspended_sale(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_org_id uuid;
  v_sale_id uuid;
  v_terminal_id uuid;
  v_recovery_mutation_id uuid;
  v_sale public.suspended_sales%ROWTYPE;
  v_claim_id uuid;
BEGIN
  IF v_user_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_suspended_sale_recovery' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_sale_id := NULLIF(p_payload->>'suspended_sale_id', '')::uuid;
    v_terminal_id := NULLIF(p_payload->>'terminal_id', '')::uuid;
    v_recovery_mutation_id := NULLIF(p_payload->>'recovery_client_mutation_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_suspended_sale_recovery' USING ERRCODE = '22023';
  END;

  IF v_store_id IS NULL OR v_sale_id IS NULL OR v_terminal_id IS NULL OR v_recovery_mutation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_suspended_sale_recovery' USING ERRCODE = '22023';
  END IF;

  SELECT s.org_id
  INTO v_org_id
  FROM public.stores s
  WHERE s.id = v_store_id
    AND s.is_active IS TRUE;
  IF v_org_id IS NULL
    OR v_org_id IS DISTINCT FROM public.current_user_org_id()
    OR public.user_store_role(v_store_id) IS NULL
  THEN
    RAISE EXCEPTION 'forbidden_suspended_sale' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_sale
  FROM public.suspended_sales ss
  WHERE ss.id = v_sale_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_sale.org_id IS DISTINCT FROM v_org_id
    OR v_sale.store_id IS DISTINCT FROM v_store_id
  THEN
    RAISE EXCEPTION 'suspended_sale_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_sale.status = 'completed' THEN
    RAISE EXCEPTION 'suspended_sale_completed' USING ERRCODE = '40001';
  END IF;

  IF v_sale.status = 'claimed' THEN
    IF v_sale.recovery_client_mutation_id = v_recovery_mutation_id
      AND v_sale.claimed_by = v_user_id
      AND v_sale.claimed_terminal_id = v_terminal_id
    THEN
      RETURN jsonb_build_object(
        'suspended_sale_id', v_sale.id,
        'status', v_sale.status,
        'claim_id', v_sale.claim_id,
        'store_id', v_sale.store_id,
        'terminal_id', v_sale.claimed_terminal_id,
        'snapshot', v_sale.snapshot,
        'replay', true
      );
    END IF;
    RAISE EXCEPTION 'suspended_sale_claimed' USING ERRCODE = '40001';
  END IF;

  v_claim_id := gen_random_uuid();
  UPDATE public.suspended_sales
  SET status = 'claimed',
      claimed_by = v_user_id,
      claimed_at = now(),
      claim_id = v_claim_id,
      claimed_terminal_id = v_terminal_id,
      recovery_client_mutation_id = v_recovery_mutation_id
  WHERE id = v_sale.id
    AND status = 'suspended';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'suspended_sale_claimed' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.audit_logs (
    org_id, store_id, user_id, entity_type, entity_id, action, payload
  )
  VALUES (
    v_sale.org_id,
    v_sale.store_id,
    v_user_id,
    'suspended_sale',
    v_sale.id,
    'sale.recovered',
    jsonb_build_object(
      'claim_id', v_claim_id,
      'recovery_client_mutation_id', v_recovery_mutation_id,
      'terminal_id', v_terminal_id
    )
  );

  RETURN jsonb_build_object(
    'suspended_sale_id', v_sale.id,
    'status', 'claimed',
    'claim_id', v_claim_id,
    'store_id', v_sale.store_id,
    'terminal_id', v_terminal_id,
    'snapshot', v_sale.snapshot,
    'replay', false
  );
END
$$;

CREATE OR REPLACE FUNCTION public.release_suspended_sale(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_sale_id uuid;
  v_claim_id uuid;
  v_org_id uuid;
  v_sale public.suspended_sales%ROWTYPE;
BEGIN
  IF v_user_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_suspended_sale_release' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_sale_id := NULLIF(p_payload->>'suspended_sale_id', '')::uuid;
    v_claim_id := NULLIF(p_payload->>'claim_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_suspended_sale_release' USING ERRCODE = '22023';
  END;

  SELECT s.org_id
  INTO v_org_id
  FROM public.stores s
  WHERE s.id = v_store_id
    AND s.is_active IS TRUE;
  IF v_org_id IS NULL
    OR v_org_id IS DISTINCT FROM public.current_user_org_id()
    OR public.user_store_role(v_store_id) IS NULL
  THEN
    RAISE EXCEPTION 'forbidden_suspended_sale' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_sale
  FROM public.suspended_sales ss
  WHERE ss.id = v_sale_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_sale.org_id IS DISTINCT FROM v_org_id
    OR v_sale.store_id IS DISTINCT FROM v_store_id
  THEN
    RAISE EXCEPTION 'suspended_sale_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_sale.status = 'suspended' THEN
    RETURN jsonb_build_object(
      'suspended_sale_id', v_sale.id,
      'status', v_sale.status,
      'replay', true
    );
  END IF;
  IF v_sale.status <> 'claimed'
    OR v_sale.claim_id IS DISTINCT FROM v_claim_id
    OR v_sale.claimed_by IS DISTINCT FROM v_user_id
  THEN
    RAISE EXCEPTION 'suspended_sale_claim_conflict' USING ERRCODE = '40001';
  END IF;

  UPDATE public.suspended_sales
  SET status = 'suspended',
      claimed_by = NULL,
      claimed_at = NULL,
      claim_id = NULL,
      claimed_terminal_id = NULL,
      recovery_client_mutation_id = NULL
  WHERE id = v_sale.id
    AND status = 'claimed';

  INSERT INTO public.audit_logs (
    org_id, store_id, user_id, entity_type, entity_id, action, payload
  )
  VALUES (
    v_sale.org_id,
    v_sale.store_id,
    v_user_id,
    'suspended_sale',
    v_sale.id,
    'sale.released',
    jsonb_build_object('claim_id', v_claim_id)
  );

  RETURN jsonb_build_object(
    'suspended_sale_id', v_sale.id,
    'status', 'suspended',
    'replay', false
  );
END
$$;

CREATE OR REPLACE FUNCTION public.complete_suspended_sale_core(
  p_payload jsonb,
  p_with_cash boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_sale_id uuid;
  v_claim_id uuid;
  v_client_mutation_id uuid;
  v_org_id uuid;
  v_terminal_id uuid;
  v_sale public.suspended_sales%ROWTYPE;
  v_result jsonb;
  v_completed_status text;
  v_completed_total numeric(12, 2);
  v_item jsonb;
  v_sale_item jsonb;
  v_completed_sale_id uuid;
BEGIN
  IF v_user_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_suspended_sale_completion' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_sale_id := NULLIF(p_payload->>'suspended_sale_id', '')::uuid;
    v_claim_id := NULLIF(p_payload->>'suspension_claim_id', '')::uuid;
    v_client_mutation_id := NULLIF(p_payload->>'client_mutation_id', '')::uuid;
    v_terminal_id := NULLIF(p_payload->>'terminal_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_suspended_sale_completion' USING ERRCODE = '22023';
  END;

  IF v_store_id IS NULL
    OR v_sale_id IS NULL
    OR v_claim_id IS NULL
    OR v_client_mutation_id IS NULL
    OR jsonb_typeof(p_payload->'items') <> 'array'
  THEN
    RAISE EXCEPTION 'invalid_suspended_sale_completion' USING ERRCODE = '22023';
  END IF;

  SELECT s.org_id
  INTO v_org_id
  FROM public.stores s
  WHERE s.id = v_store_id
    AND s.is_active IS TRUE;
  IF v_org_id IS NULL
    OR v_org_id IS DISTINCT FROM public.current_user_org_id()
    OR public.user_store_role(v_store_id) IS NULL
  THEN
    RAISE EXCEPTION 'forbidden_suspended_sale' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_sale
  FROM public.suspended_sales ss
  WHERE ss.id = v_sale_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_sale.org_id IS DISTINCT FROM v_org_id
    OR v_sale.store_id IS DISTINCT FROM v_store_id
  THEN
    RAISE EXCEPTION 'suspended_sale_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_sale.status = 'completed' THEN
    IF v_sale.completion_client_mutation_id IS DISTINCT FROM v_client_mutation_id THEN
      RAISE EXCEPTION 'suspended_sale_completed' USING ERRCODE = '40001';
    END IF;
    SELECT s.id, s.status::text, s.total
    INTO v_completed_sale_id, v_completed_status, v_completed_total
    FROM public.sales s
    WHERE s.id = v_sale.completed_sale_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'suspended_sale_completion_incomplete' USING ERRCODE = '40001';
    END IF;
    RETURN jsonb_build_object(
      'sale_id', v_completed_sale_id,
      'client_mutation_id', v_client_mutation_id,
      'status', v_completed_status,
      'total', v_completed_total::text,
      'stock_reconciled', true,
      'suspended_sale_id', v_sale.id,
      'replay', true
    );
  END IF;

  IF v_sale.status <> 'claimed'
    OR v_sale.claim_id IS DISTINCT FROM v_claim_id
    OR v_sale.claimed_by IS DISTINCT FROM v_user_id
    OR v_terminal_id IS NULL
    OR v_sale.claimed_terminal_id IS DISTINCT FROM v_terminal_id
  THEN
    RAISE EXCEPTION 'suspended_sale_claim_conflict' USING ERRCODE = '40001';
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_payload->'items') AS item(value)
  LOOP
    v_sale_item := NULL;
    SELECT value
    INTO v_sale_item
    FROM jsonb_array_elements(v_sale.snapshot->'items') AS snapshot_item(value)
    WHERE value->>'product_id' = v_item->>'product_id';

    IF v_sale_item IS NOT NULL
      AND v_sale_item->>'unit_price' IS DISTINCT FROM v_item->>'unit_price'
    THEN
      RAISE EXCEPTION 'suspended_snapshot_conflict' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  p_payload := p_payload
    - 'suspended_sale_id'
    - 'suspension_claim_id'
    - 'recovery_client_mutation_id';

  IF p_with_cash THEN
    SELECT public.process_sale_with_cash(p_payload) INTO v_result;
  ELSE
    SELECT public.process_sale(p_payload) INTO v_result;
  END IF;

  UPDATE public.suspended_sales
  SET status = 'completed',
      completed_at = now(),
      completed_sale_id = (v_result->>'sale_id')::uuid,
      completion_client_mutation_id = v_client_mutation_id
  WHERE id = v_sale.id
    AND status = 'claimed'
    AND claim_id = v_claim_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'suspended_sale_completion_race' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.audit_logs (
    org_id, store_id, user_id, entity_type, entity_id, action, payload
  )
  VALUES (
    v_sale.org_id,
    v_sale.store_id,
    v_user_id,
    'suspended_sale',
    v_sale.id,
    'sale.completed_from_suspension',
    jsonb_build_object(
      'sale_id', v_result->>'sale_id',
      'client_mutation_id', v_client_mutation_id,
      'claim_id', v_claim_id,
      'cash', p_with_cash
    )
  );

  RETURN v_result
    || jsonb_build_object(
      'suspended_sale_id', v_sale.id,
      'replay', false
    );
END
$$;

CREATE OR REPLACE FUNCTION public.complete_suspended_sale(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RETURN public.complete_suspended_sale_core(p_payload, false);
END
$$;

CREATE OR REPLACE FUNCTION public.complete_suspended_sale_with_cash(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RETURN public.complete_suspended_sale_core(p_payload, true);
END
$$;

REVOKE ALL ON FUNCTION public.suspend_sale(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_suspended_sales(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.recover_suspended_sale(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_suspended_sale(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_suspended_sale(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_suspended_sale_with_cash(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_suspended_sale_core(jsonb, boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.suspend_sale(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_suspended_sales(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recover_suspended_sale(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_suspended_sale(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_suspended_sale(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_suspended_sale_with_cash(jsonb) TO authenticated;

-- Inventory precision, immutable movement access, and durable pull cursors.
--
-- This migration is additive and forward-only. Historical migrations remain
-- untouched; existing sale movements keep nullable client/import identity.

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS terminal_id uuid,
  ADD COLUMN IF NOT EXISTS movement_seq bigint GENERATED ALWAYS AS IDENTITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.inventory_balances
    WHERE quantity = 'NaN'::numeric
  ) THEN
    RAISE EXCEPTION 'legacy_inventory_balance_nan'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.inventory_movements
    WHERE quantity_change = 'NaN'::numeric
       OR balance_after = 'NaN'::numeric
  ) THEN
    RAISE EXCEPTION 'legacy_inventory_movement_nan'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'inventory_balances_quantity_finite'
      AND conrelid = 'public.inventory_balances'::regclass
  ) THEN
    ALTER TABLE public.inventory_balances
      ADD CONSTRAINT inventory_balances_quantity_finite
      CHECK (quantity <> 'NaN'::numeric);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'inventory_movements_quantity_finite'
      AND conrelid = 'public.inventory_movements'::regclass
  ) THEN
    ALTER TABLE public.inventory_movements
      ADD CONSTRAINT inventory_movements_quantity_finite
      CHECK (
        quantity_change <> 'NaN'::numeric
        AND balance_after <> 'NaN'::numeric
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.inventory_movements im
    JOIN public.sales s ON s.id = im.sale_id
    WHERE im.sale_id IS NOT NULL
      AND (
        im.store_id IS DISTINCT FROM s.store_id
        OR im.org_id IS DISTINCT FROM s.org_id
      )
  ) THEN
    RAISE EXCEPTION 'legacy_inventory_movement_sale_scope_violation'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'fk_inventory_movements_sale_store_org'
      AND conrelid = 'public.inventory_movements'::regclass
  ) THEN
    ALTER TABLE public.inventory_movements
      ADD CONSTRAINT fk_inventory_movements_sale_store_org
      FOREIGN KEY (sale_id, store_id, org_id)
      REFERENCES public.sales (id, store_id, org_id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_inventory_movements_store_created_id
  ON public.inventory_movements (store_id, created_at ASC, id ASC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_movements_movement_seq
  ON public.inventory_movements (movement_seq);

CREATE INDEX IF NOT EXISTS idx_inventory_balances_store_updated_product
  ON public.inventory_balances (store_id, updated_at ASC, product_id ASC);

-- A movement is valid only after its canonical RPC has updated the matching
-- balance in the same transaction. Direct authenticated writes are revoked
-- below; this trigger also catches future privileged write paths.
CREATE OR REPLACE FUNCTION public.assert_inventory_movement_matches_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_quantity numeric(12, 3);
  v_previous_balance numeric(12, 3);
BEGIN
  SELECT ib.quantity
  INTO v_quantity
  FROM public.inventory_balances ib
  WHERE ib.org_id = NEW.org_id
    AND ib.store_id = NEW.store_id
    AND ib.product_id = NEW.product_id;

  IF NOT FOUND
    OR v_quantity IS DISTINCT FROM NEW.balance_after
    OR NEW.balance_after - NEW.quantity_change < 0
  THEN
    RAISE EXCEPTION 'inventory_movement_balance_mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT im.balance_after
  INTO v_previous_balance
  FROM public.inventory_movements im
  WHERE im.org_id = NEW.org_id
    AND im.store_id = NEW.store_id
    AND im.product_id = NEW.product_id
    AND im.id IS DISTINCT FROM NEW.id
  ORDER BY im.movement_seq DESC
  LIMIT 1;

  IF FOUND
    AND v_previous_balance + NEW.quantity_change IS DISTINCT FROM NEW.balance_after
  THEN
    RAISE EXCEPTION 'inventory_movement_chain_mismatch'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_inventory_movement_matches_balance() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_inventory_movement_matches_balance() FROM anon;
REVOKE ALL ON FUNCTION public.assert_inventory_movement_matches_balance() FROM authenticated;

DROP TRIGGER IF EXISTS inventory_movement_matches_balance
  ON public.inventory_movements;
CREATE TRIGGER inventory_movement_matches_balance
  BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_inventory_movement_matches_balance();

-- The database is the immutability boundary. RLS has no UPDATE/DELETE policy,
-- and these residual table privileges must also be removed because RLS does
-- not protect TRUNCATE, TRIGGER, or REFERENCES operations.
REVOKE ALL ON TABLE public.inventory_balances, public.inventory_movements
  FROM authenticated;
REVOKE ALL ON TABLE public.inventory_balances, public.inventory_movements
  FROM anon;
GRANT SELECT ON TABLE public.inventory_balances, public.inventory_movements
  TO authenticated;

CREATE OR REPLACE FUNCTION public.adjust_inventory(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_product_id uuid;
  v_client_mutation_id uuid;
  v_terminal_id uuid;
  v_import_id uuid;
  v_import_row integer;
  v_delta numeric;
  v_reason text;
  v_type public.inventory_movement_type;
  v_org_id uuid;
  v_role public.member_role;
  v_balance numeric(12, 3);
  v_next numeric(12, 3);
  v_movement_id uuid;
  v_movement_created_at timestamptz;
  v_existing public.inventory_movements%ROWTYPE;
BEGIN
  IF v_user_id IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(jsonb_typeof(p_payload->'store_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'product_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'client_mutation_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'reason') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'movement_type') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'delta') NOT IN ('number', 'string'), true)
  THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_product_id := NULLIF(p_payload->>'product_id', '')::uuid;
    v_client_mutation_id := NULLIF(p_payload->>'client_mutation_id', '')::uuid;
    v_delta := (p_payload->>'delta')::numeric;
    IF p_payload ? 'terminal_id' THEN
      IF jsonb_typeof(p_payload->'terminal_id') <> 'string' THEN
        RAISE EXCEPTION 'invalid_terminal_identity' USING ERRCODE = '22023';
      END IF;
      v_terminal_id := NULLIF(p_payload->>'terminal_id', '')::uuid;
    END IF;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END;

  v_reason := NULLIF(btrim(p_payload->>'reason'), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  IF length(v_reason) > 500 THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;

  IF p_payload->>'movement_type' NOT IN ('restock', 'adjustment') THEN
    RAISE EXCEPTION 'invalid_movement_type' USING ERRCODE = '22023';
  END IF;
  v_type := (p_payload->>'movement_type')::public.inventory_movement_type;

  IF v_store_id IS NULL
    OR v_product_id IS NULL
    OR v_client_mutation_id IS NULL
    OR v_delta IS NULL
    OR v_delta = 0
    OR abs(v_delta) > 999999999.999
    OR scale(v_delta) > 3
  THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF v_type = 'restock' AND v_delta <= 0 THEN
    RAISE EXCEPTION 'restock_requires_positive_delta' USING ERRCODE = '22023';
  END IF;
  v_delta := v_delta::numeric(12, 3);

  IF (p_payload ? 'import_id') <> (p_payload ? 'import_row') THEN
    RAISE EXCEPTION 'invalid_import_identity' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'import_id' THEN
    IF COALESCE(jsonb_typeof(p_payload->'import_id') <> 'string', true)
      OR COALESCE(jsonb_typeof(p_payload->'import_row') NOT IN ('number', 'string'), true)
    THEN
      RAISE EXCEPTION 'invalid_import_identity' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_import_id := NULLIF(p_payload->>'import_id', '')::uuid;
      v_import_row := (p_payload->>'import_row')::integer;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'invalid_import_identity' USING ERRCODE = '22023';
    END;
    IF v_import_id IS NULL OR v_import_row IS NULL OR v_import_row <= 0 THEN
      RAISE EXCEPTION 'invalid_import_identity' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT s.org_id
  INTO v_org_id
  FROM public.stores s
  WHERE s.id = v_store_id
    AND s.is_active IS TRUE;

  v_role := public.user_store_role(v_store_id);
  IF v_org_id IS NULL
    OR v_org_id IS DISTINCT FROM public.current_user_org_id()
    OR v_role IS NULL
    OR v_role NOT IN ('admin', 'manager')
  THEN
    RAISE EXCEPTION 'forbidden_inventory' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = v_product_id
      AND p.org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = '22023';
  END IF;

  -- Always acquire identity locks before reading either identity. This
  -- serializes retries and avoids a SELECT/INSERT race.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      v_org_id::text || ':' || v_store_id::text || ':mutation:' || v_client_mutation_id::text,
      0
    )
  );
  IF v_import_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        v_org_id::text || ':' || v_store_id::text || ':import:' || v_import_id::text || ':' || v_import_row::text,
        0
      )
    );
  END IF;

  SELECT *
  INTO v_existing
  FROM public.inventory_movements im
  WHERE im.org_id = v_org_id
    AND im.store_id = v_store_id
    AND im.client_mutation_id = v_client_mutation_id
  FOR UPDATE;

  IF NOT FOUND AND v_import_id IS NOT NULL THEN
    SELECT *
    INTO v_existing
    FROM public.inventory_movements im
    WHERE im.org_id = v_org_id
      AND im.store_id = v_store_id
      AND im.import_id = v_import_id
      AND im.import_row = v_import_row
    FOR UPDATE;
  END IF;

  IF FOUND THEN
    IF v_existing.client_mutation_id IS DISTINCT FROM v_client_mutation_id
      OR v_existing.import_id IS DISTINCT FROM v_import_id
      OR v_existing.import_row IS DISTINCT FROM v_import_row
      OR v_existing.terminal_id IS DISTINCT FROM v_terminal_id
      OR v_existing.product_id IS DISTINCT FROM v_product_id
      OR v_existing.quantity_change IS DISTINCT FROM v_delta
      OR v_existing.reason IS DISTINCT FROM v_reason
      OR v_existing.movement_type IS DISTINCT FROM v_type
    THEN
      RAISE EXCEPTION 'idempotency_payload_mismatch' USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'movement_id', v_existing.id,
      'client_mutation_id', v_existing.client_mutation_id,
      'terminal_id', v_existing.terminal_id,
      'import_id', v_existing.import_id,
      'import_row', v_existing.import_row,
      'product_id', v_existing.product_id,
      'movement_type', v_existing.movement_type,
      'created_at', v_existing.created_at::text,
      'replay', true,
      'balance_after', v_existing.balance_after::text,
      'delta', v_existing.quantity_change::text
    );
  END IF;

  INSERT INTO public.inventory_balances (org_id, store_id, product_id, quantity)
  VALUES (v_org_id, v_store_id, v_product_id, 0)
  ON CONFLICT (store_id, product_id) DO NOTHING;

  SELECT ib.quantity
  INTO v_balance
  FROM public.inventory_balances ib
  WHERE ib.org_id = v_org_id
    AND ib.store_id = v_store_id
    AND ib.product_id = v_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory_scope_mismatch' USING ERRCODE = '23514';
  END IF;

  v_next := v_balance + v_delta;
  IF v_next < 0 THEN
    RAISE EXCEPTION 'negative_stock' USING ERRCODE = '22023';
  END IF;

  UPDATE public.inventory_balances
  SET quantity = v_next,
      updated_at = now()
  WHERE org_id = v_org_id
    AND store_id = v_store_id
    AND product_id = v_product_id;

  INSERT INTO public.inventory_movements (
    org_id,
    store_id,
    product_id,
    movement_type,
    quantity_change,
    balance_after,
    created_by,
    reason,
    actor_role,
    client_mutation_id,
    import_id,
    import_row,
    terminal_id
  )
  VALUES (
    v_org_id,
    v_store_id,
    v_product_id,
    v_type,
    v_delta,
    v_next,
    v_user_id,
    v_reason,
    v_role,
    v_client_mutation_id,
    v_import_id,
    v_import_row,
    v_terminal_id
  )
  RETURNING id, created_at
  INTO v_movement_id, v_movement_created_at;

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
    'inventory_movement',
    v_movement_id,
    'adjust_inventory',
    jsonb_build_object(
      'client_mutation_id', v_client_mutation_id,
      'terminal_id', v_terminal_id,
      'import_id', v_import_id,
      'import_row', v_import_row,
      'delta', v_delta,
      'reason', v_reason,
      'actor_role', v_role,
      'movement_type', v_type,
      'product_id', v_product_id,
      'balance_after', v_next
    )
  );

  RETURN jsonb_build_object(
    'movement_id', v_movement_id,
    'client_mutation_id', v_client_mutation_id,
    'terminal_id', v_terminal_id,
    'import_id', v_import_id,
    'import_row', v_import_row,
    'product_id', v_product_id,
    'movement_type', v_type,
    'created_at', v_movement_created_at::text,
    'replay', false,
    'balance_after', v_next::text,
    'delta', v_delta::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_inventory_page(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_org_id uuid;
  v_after_sku text;
  v_limit integer;
  v_can_manage boolean;
  v_rows jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  v_store_id := (p_payload->>'store_id')::uuid;
  v_after_sku := NULLIF(p_payload->>'cursor_sku', '');
  v_limit := LEAST(GREATEST(COALESCE((p_payload->>'limit')::integer, 20), 1), 100);

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'store_id_required' USING ERRCODE = '22023';
  END IF;
  IF public.user_has_store_access(v_store_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'forbidden_store' USING ERRCODE = '42501';
  END IF;

  SELECT s.org_id
  INTO v_org_id
  FROM public.stores s
  WHERE s.id = v_store_id
    AND s.is_active IS TRUE;

  IF v_org_id IS NULL
    OR v_org_id IS DISTINCT FROM public.current_user_org_id()
  THEN
    RAISE EXCEPTION 'forbidden_store' USING ERRCODE = '42501';
  END IF;

  v_can_manage := public.user_can_manage_inventory(v_store_id);

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.sku), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      p.id AS product_id,
      p.sku,
      p.name,
      p.is_active,
      to_char(p.unit_price, 'FM999999999.00') AS unit_price,
      CASE
        WHEN v_can_manage IS TRUE
          THEN to_char(p.cost_price, 'FM999999999.00')
        ELSE NULL
      END AS cost_price,
      to_char(COALESCE(ib.quantity, 0), 'FM999999999.000') AS quantity
    FROM public.products p
    LEFT JOIN public.inventory_balances ib
      ON ib.org_id = v_org_id
     AND ib.store_id = v_store_id
     AND ib.product_id = p.id
    WHERE p.org_id = v_org_id
      AND (p.is_active IS TRUE OR v_can_manage IS TRUE)
      AND (v_after_sku IS NULL OR p.sku > v_after_sku)
    ORDER BY p.sku
    LIMIT v_limit
  ) t;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'next_cursor', CASE
      WHEN jsonb_array_length(v_rows) = v_limit
        THEN v_rows -> (v_limit - 1) ->> 'sku'
      ELSE NULL
    END,
    'can_adjust', v_can_manage
  );
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_inventory(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.adjust_inventory(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.adjust_inventory(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.get_inventory_page(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_inventory_page(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_page(jsonb) TO authenticated;

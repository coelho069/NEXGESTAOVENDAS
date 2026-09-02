-- Security hardening after Sprint 4.
-- This migration changes policies, grants, function behavior and defensive
-- triggers only. It intentionally adds no columns or foreign keys, because
-- the applied database must be checked for legacy org/store inconsistencies.

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- A profile is not an authorization administration surface.
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
REVOKE UPDATE ON public.profiles FROM authenticated;

CREATE OR REPLACE FUNCTION public.user_has_store_access(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.store_members sm
      JOIN public.stores s
        ON s.id = sm.store_id
       AND s.org_id = sm.org_id
      WHERE sm.store_id = p_store_id
        AND sm.user_id = (SELECT auth.uid())
        AND sm.org_id = public.current_user_org_id()
        AND s.is_active = true
    );
$$;

CREATE OR REPLACE FUNCTION public.user_store_role(p_store_id uuid)
RETURNS public.member_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT sm.role
  FROM public.store_members sm
  JOIN public.stores s
    ON s.id = sm.store_id
   AND s.org_id = sm.org_id
  WHERE sm.store_id = p_store_id
    AND sm.user_id = (SELECT auth.uid())
    AND sm.org_id = public.current_user_org_id()
    AND s.is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.user_has_org_role(p_roles public.member_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND p_roles IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.store_members sm
      JOIN public.stores s
        ON s.id = sm.store_id
       AND s.org_id = sm.org_id
      WHERE sm.user_id = (SELECT auth.uid())
        AND sm.org_id = public.current_user_org_id()
        AND sm.role = ANY (p_roles)
        AND s.is_active = true
    );
$$;

REVOKE ALL ON FUNCTION public.user_has_org_role(public.member_role[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_org_role(public.member_role[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.category_belongs_to_org(
  p_category_id uuid,
  p_org_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT p_category_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.categories c
      WHERE c.id = p_category_id
        AND c.org_id = p_org_id
    );
$$;

REVOKE ALL ON FUNCTION public.category_belongs_to_org(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.category_belongs_to_org(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.user_can_manage_inventory(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.user_store_role(p_store_id) IN ('admin', 'manager');
$$;

CREATE OR REPLACE FUNCTION public.user_can_view_reports(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.user_store_role(p_store_id) IN ('admin', 'manager');
$$;

-- Product/category authorization is membership-based and remains
-- organization-scoped for catalog resources.
DROP POLICY IF EXISTS products_admin_insert ON public.products;
DROP POLICY IF EXISTS products_admin_update ON public.products;
DROP POLICY IF EXISTS products_admin_delete ON public.products;
DROP POLICY IF EXISTS products_manager_insert ON public.products;
DROP POLICY IF EXISTS products_manager_update ON public.products;
DROP POLICY IF EXISTS products_select_managed ON public.products;

CREATE POLICY products_catalog_insert ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.current_user_org_id()
    AND public.user_has_org_role(ARRAY['admin', 'manager']::public.member_role[])
    AND public.category_belongs_to_org(category_id, public.current_user_org_id())
  );

CREATE POLICY products_catalog_update ON public.products
  FOR UPDATE TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_has_org_role(ARRAY['admin', 'manager']::public.member_role[])
  )
  WITH CHECK (
    org_id = public.current_user_org_id()
    AND public.user_has_org_role(ARRAY['admin', 'manager']::public.member_role[])
    AND public.category_belongs_to_org(category_id, public.current_user_org_id())
  );

CREATE POLICY products_catalog_delete ON public.products
  FOR DELETE TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_has_org_role(ARRAY['admin']::public.member_role[])
  );

CREATE POLICY products_select_managed ON public.products
  FOR SELECT TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_has_org_role(ARRAY['admin', 'manager']::public.member_role[])
  );

DROP POLICY IF EXISTS categories_admin_write ON public.categories;
DROP POLICY IF EXISTS categories_manager_write ON public.categories;

CREATE POLICY categories_catalog_insert ON public.categories
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.current_user_org_id()
    AND public.user_has_org_role(ARRAY['admin', 'manager']::public.member_role[])
  );

CREATE POLICY categories_catalog_update ON public.categories
  FOR UPDATE TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_has_org_role(ARRAY['admin', 'manager']::public.member_role[])
  )
  WITH CHECK (
    org_id = public.current_user_org_id()
    AND public.user_has_org_role(ARRAY['admin', 'manager']::public.member_role[])
  );

CREATE POLICY categories_catalog_delete ON public.categories
  FOR DELETE TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_has_org_role(ARRAY['admin']::public.member_role[])
  );

-- RLS cannot hide a column. Column-level grants prevent direct cost reads.
REVOKE SELECT ON public.products FROM authenticated;
GRANT SELECT (
  id, org_id, category_id, sku, name, description, unit_price, barcode,
  is_active, created_at, updated_at
) ON public.products TO authenticated;

-- Audit events are produced by trusted RPCs, never by the browser.
DROP POLICY IF EXISTS audit_logs_insert ON public.audit_logs;
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM authenticated;

CREATE OR REPLACE FUNCTION public.assert_sale_payment_cardinality()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_sale_id uuid;
  v_payment_count integer;
BEGIN
  IF TG_TABLE_NAME = 'sales' THEN
    v_sale_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    v_sale_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.sale_id ELSE NEW.sale_id END;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.sales
    WHERE id = v_sale_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT count(*)
  INTO v_payment_count
  FROM public.payments
  WHERE sale_id = v_sale_id;

  IF v_payment_count <> 1 THEN
    RAISE EXCEPTION 'sale_requires_exactly_one_payment' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_sale_payment_cardinality() FROM PUBLIC;

DROP TRIGGER IF EXISTS sale_requires_one_payment ON public.sales;
CREATE CONSTRAINT TRIGGER sale_requires_one_payment
  AFTER INSERT OR UPDATE ON public.sales
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_sale_payment_cardinality();

DROP TRIGGER IF EXISTS payment_requires_one_per_sale ON public.payments;
CREATE CONSTRAINT TRIGGER payment_requires_one_per_sale
  AFTER INSERT OR UPDATE OR DELETE ON public.payments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_sale_payment_cardinality();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.sales s
    LEFT JOIN public.payments p ON p.sale_id = s.id
    GROUP BY s.id
    HAVING count(p.id) <> 1
  ) THEN
    RAISE EXCEPTION 'legacy_sale_payment_cardinality_violation' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_sale_payload_integrity(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_item_discount numeric;
  v_item_total numeric;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_total numeric;
  v_payment_amount numeric;
  v_seen_products uuid[] := ARRAY[]::uuid[];
BEGIN
  IF (SELECT auth.uid()) IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
    OR COALESCE(jsonb_typeof(p_payload->'items') <> 'array', true)
    OR CASE
      WHEN jsonb_typeof(p_payload->'items') = 'array'
        THEN jsonb_array_length(p_payload->'items') = 0
      ELSE true
    END
    OR COALESCE(jsonb_typeof(p_payload->'payments') <> 'array', true)
    OR CASE
      WHEN jsonb_typeof(p_payload->'payments') = 'array'
        THEN jsonb_array_length(p_payload->'payments') <> 1
      ELSE true
    END
  THEN
    RAISE EXCEPTION 'invalid_sale_payload' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(jsonb_typeof(p_payload->'store_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'client_mutation_id') <> 'string', true)
  THEN
    RAISE EXCEPTION 'invalid_sale_payload' USING ERRCODE = '22023';
  END IF;

  BEGIN
    PERFORM (p_payload->>'store_id')::uuid;
    PERFORM (p_payload->>'client_mutation_id')::uuid;
    IF p_payload ? 'customer_id' AND NULLIF(p_payload->>'customer_id', '') IS NOT NULL THEN
      PERFORM (p_payload->>'customer_id')::uuid;
    END IF;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_sale_payload' USING ERRCODE = '22023';
  END;

  IF p_payload ? 'customer_id'
    AND COALESCE(jsonb_typeof(p_payload->'customer_id') <> 'string', true)
  THEN
    RAISE EXCEPTION 'invalid_sale_payload' USING ERRCODE = '22023';
  END IF;

  IF p_payload ? 'discount' THEN
    IF COALESCE(jsonb_typeof(p_payload->'discount') <> 'string', true)
      OR (p_payload->>'discount') !~ '^(0|[1-9][0-9]{0,9})\.[0-9]{2}$'
    THEN
      RAISE EXCEPTION 'invalid_discount' USING ERRCODE = '22023';
    END IF;
    v_discount := (p_payload->>'discount')::numeric;
  END IF;

  IF v_discount < 0 OR v_discount > 9999999999.99 THEN
    RAISE EXCEPTION 'invalid_discount' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_payload->'items') AS t(value)
  LOOP
    IF COALESCE(jsonb_typeof(v_item->'product_id') <> 'string', true)
      OR COALESCE(jsonb_typeof(v_item->'quantity') <> 'number', true)
      OR COALESCE(jsonb_typeof(v_item->'unit_price') <> 'string', true)
    THEN
      RAISE EXCEPTION 'invalid_sale_item' USING ERRCODE = '22023';
    END IF;

    IF v_item ? 'discount'
      AND COALESCE(jsonb_typeof(v_item->'discount') <> 'string', true)
    THEN
      RAISE EXCEPTION 'invalid_sale_item' USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_product_id := (v_item->>'product_id')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'invalid_sale_item' USING ERRCODE = '22023';
    END;
    IF v_product_id = ANY(v_seen_products) THEN
      RAISE EXCEPTION 'duplicate_product' USING ERRCODE = '22023';
    END IF;
    v_seen_products := array_append(v_seen_products, v_product_id);

    IF (v_item->>'unit_price') !~ '^(0|[1-9][0-9]{0,9})\.[0-9]{2}$'
      OR (
        v_item ? 'discount'
        AND (v_item->>'discount') !~ '^(0|[1-9][0-9]{0,9})\.[0-9]{2}$'
      )
    THEN
      RAISE EXCEPTION 'invalid_sale_item' USING ERRCODE = '22023';
    END IF;

    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_item_discount := COALESCE((v_item->>'discount')::numeric, 0);

    IF v_quantity <= 0
      OR v_quantity > 999999999.999
      OR v_quantity <> round(v_quantity, 3)
      OR v_item_discount < 0
      OR v_item_discount > 9999999999.99
    THEN
      RAISE EXCEPTION 'invalid_sale_item' USING ERRCODE = '22023';
    END IF;

    v_item_total := round(v_quantity * v_unit_price - v_item_discount, 2);
    IF v_item_total < 0 THEN
      RAISE EXCEPTION 'invalid_item_total' USING ERRCODE = '22023';
    END IF;
    v_subtotal := v_subtotal + v_item_total;
  END LOOP;

  IF v_subtotal > 9999999999.99 THEN
    RAISE EXCEPTION 'invalid_total' USING ERRCODE = '22023';
  END IF;

  v_total := round(v_subtotal - v_discount, 2);
  IF v_total < 0 OR v_total > 9999999999.99 THEN
    RAISE EXCEPTION 'invalid_total' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(jsonb_typeof((p_payload->'payments')->0) <> 'object', true)
    OR COALESCE(jsonb_typeof((p_payload->'payments')->0->'method') <> 'string', true)
    OR (p_payload->'payments'->0->>'method') <> 'cash'
    OR COALESCE(jsonb_typeof((p_payload->'payments')->0->'amount') <> 'string', true)
    OR (p_payload->'payments'->0->>'amount') !~ '^(0|[1-9][0-9]{0,9})\.[0-9]{2}$'
  THEN
    RAISE EXCEPTION 'payment_method_not_configured' USING ERRCODE = '22023';
  END IF;

  v_payment_amount := (p_payload->'payments'->0->>'amount')::numeric;
  IF v_payment_amount <> v_total THEN
    RAISE EXCEPTION 'payment_total_mismatch' USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_sale_payload_integrity(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sale_payload_matches(
  p_sale_id uuid,
  p_payload jsonb
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_client_mutation_id uuid := NULLIF(p_payload->>'client_mutation_id', '')::uuid;
  v_customer_id uuid := NULLIF(p_payload->>'customer_id', '')::uuid;
  v_discount numeric(12, 2) := COALESCE((p_payload->>'discount')::numeric(12, 2), 0);
  v_subtotal numeric(12, 2) := 0;
  v_total numeric(12, 2);
  v_item jsonb;
  v_payload_items jsonb;
  v_sale_items jsonb;
  v_payload_payments jsonb;
  v_sale_payments jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RETURN false;
  END IF;

  SELECT *
  INTO v_sale
  FROM public.sales
  WHERE id = p_sale_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb)) AS t(value)
  LOOP
    v_subtotal := v_subtotal + round(
      (v_item->>'quantity')::numeric(12, 3)
        * (v_item->>'unit_price')::numeric(12, 2)
        - COALESCE((v_item->>'discount')::numeric(12, 2), 0),
      2
    );
  END LOOP;
  v_total := round(v_subtotal - v_discount, 2);

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'product_id', (value->>'product_id')::uuid::text,
        'quantity', (value->>'quantity')::numeric(12, 3),
        'unit_price', (value->>'unit_price')::numeric(12, 2),
        'discount', COALESCE((value->>'discount')::numeric(12, 2), 0),
        'total', round(
          (value->>'quantity')::numeric(12, 3)
            * (value->>'unit_price')::numeric(12, 2)
            - COALESCE((value->>'discount')::numeric(12, 2), 0),
          2
        )
      )
      ORDER BY value->>'product_id'
    ),
    '[]'::jsonb
  )
  INTO v_payload_items
  FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb)) AS item(value);

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'product_id', si.product_id::text,
        'quantity', si.quantity,
        'unit_price', si.unit_price,
        'discount', si.discount,
        'total', si.total
      )
      ORDER BY si.product_id::text
    ),
    '[]'::jsonb
  )
  INTO v_sale_items
  FROM public.sale_items si
  WHERE si.sale_id = p_sale_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'method', value->>'method',
        'amount', (value->>'amount')::numeric(12, 2)
      )
      ORDER BY value->>'method', (value->>'amount')::numeric(12, 2)
    ),
    '[]'::jsonb
  )
  INTO v_payload_payments
  FROM jsonb_array_elements(COALESCE(p_payload->'payments', '[]'::jsonb)) AS payment(value);

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'method', p.method::text,
        'amount', p.amount
      )
      ORDER BY p.method::text, p.amount
    ),
    '[]'::jsonb
  )
  INTO v_sale_payments
  FROM public.payments p
  WHERE p.sale_id = p_sale_id;

  RETURN COALESCE(v_sale.store_id = NULLIF(p_payload->>'store_id', '')::uuid, false)
    AND v_sale.client_mutation_id = v_client_mutation_id
    AND v_sale.customer_id IS NOT DISTINCT FROM v_customer_id
    AND v_sale.subtotal = v_subtotal
    AND v_sale.discount = v_discount
    AND v_sale.total = v_total
    AND v_sale_items = v_payload_items
    AND v_sale_payments = v_payload_payments;
END;
$$;

REVOKE ALL ON FUNCTION public.sale_payload_matches(uuid, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.assert_sale_discount_cap(
  p_store_id uuid,
  p_discount numeric,
  p_subtotal numeric
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_role public.member_role;
  v_percent numeric(12, 2);
  v_max numeric;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.user_has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'forbidden_store' USING ERRCODE = '42501';
  END IF;
  IF p_discount IS NULL OR p_discount <= 0 THEN
    RETURN;
  END IF;

  v_role := public.user_store_role(p_store_id);
  v_percent := CASE v_role
    WHEN 'cashier' THEN 5
    WHEN 'manager' THEN 20
    WHEN 'admin' THEN 100
  END;
  v_max := round(COALESCE(p_subtotal, 0) * v_percent / 100.0, 2);

  IF p_discount > v_max THEN
    RAISE EXCEPTION 'discount_limit_exceeded' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_sale_discount_cap(uuid, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_sale_discount_cap(uuid, numeric, numeric) TO authenticated;

-- Serialize only the same store/mutation pair. This makes the existing
-- process_sale_core return a deterministic replay under concurrent retries.
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
      'replay', true,
      'status', v_status,
      'total', v_total
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
  RETURN public.process_sale_core(p_payload);
END;
$$;

REVOKE ALL ON FUNCTION public.process_sale(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_sale(jsonb) TO authenticated;

-- Keep timestamps and sale movement metadata consistent for future writes.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'organizations', 'stores', 'profiles', 'categories', 'products',
    'customers', 'sales', 'inventory_balances', 'fiscal_documents'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', v_table);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      v_table
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_inventory_sale_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.movement_type = 'sale' THEN
    NEW.reason := COALESCE(NEW.reason, 'sale');
    NEW.actor_role := COALESCE(NEW.actor_role, public.user_store_role(NEW.store_id));
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_inventory_sale_metadata() FROM PUBLIC;
DROP TRIGGER IF EXISTS set_inventory_sale_metadata ON public.inventory_movements;
CREATE TRIGGER set_inventory_sale_metadata
  BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.set_inventory_sale_metadata();

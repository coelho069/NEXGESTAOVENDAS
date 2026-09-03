-- Scope catalog mutations to the store supplied by the caller.
-- Products remain organization-wide records; the store is the authorization
-- context for the mutation and is never accepted as the target organization.

DROP POLICY IF EXISTS products_admin_insert ON public.products;
DROP POLICY IF EXISTS products_admin_update ON public.products;
DROP POLICY IF EXISTS products_admin_delete ON public.products;
DROP POLICY IF EXISTS products_manager_insert ON public.products;
DROP POLICY IF EXISTS products_manager_update ON public.products;
DROP POLICY IF EXISTS products_catalog_insert ON public.products;
DROP POLICY IF EXISTS products_catalog_update ON public.products;
DROP POLICY IF EXISTS products_catalog_delete ON public.products;
DROP POLICY IF EXISTS products_membership_insert ON public.products;
DROP POLICY IF EXISTS products_membership_update ON public.products;
DROP POLICY IF EXISTS products_membership_delete ON public.products;
DROP POLICY IF EXISTS products_membership_select ON public.products;

DROP POLICY IF EXISTS categories_admin_write ON public.categories;
DROP POLICY IF EXISTS categories_manager_write ON public.categories;
DROP POLICY IF EXISTS categories_catalog_insert ON public.categories;
DROP POLICY IF EXISTS categories_catalog_update ON public.categories;
DROP POLICY IF EXISTS categories_catalog_delete ON public.categories;
DROP POLICY IF EXISTS categories_membership_write ON public.categories;
DROP POLICY IF EXISTS audit_logs_membership_select ON public.audit_logs;

DROP FUNCTION IF EXISTS public.user_has_org_role(public.member_role[]);

CREATE OR REPLACE FUNCTION public.user_has_org_role(
  p_store_id uuid,
  p_roles public.member_role[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND p_store_id IS NOT NULL
    AND p_roles IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.store_members sm
      JOIN public.stores s
        ON s.id = sm.store_id
       AND s.org_id = sm.org_id
      WHERE sm.user_id = (SELECT auth.uid())
        AND sm.store_id = p_store_id
        AND sm.org_id = public.current_user_org_id()
        AND sm.role = ANY (p_roles)
        AND s.is_active = true
    );
$$;

REVOKE ALL ON FUNCTION public.user_has_org_role(uuid, public.member_role[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_org_role(uuid, public.member_role[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.user_has_org_role(uuid, public.member_role[]) TO authenticated;

-- Direct table writes cannot carry the authorization store_id. Mutations must
-- use the RPCs below, which validate that context before writing the org
-- catalog. Read access remains governed by the existing SELECT policies.
REVOKE INSERT, UPDATE, DELETE ON public.products FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.categories FROM authenticated;

CREATE OR REPLACE FUNCTION public.create_product(
  p_store_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_org_id uuid;
  v_product_id uuid;
  v_category_id uuid;
  v_sku text;
  v_name text;
  v_barcode text;
  v_unit_price numeric(12, 2);
  v_cost_price numeric(12, 2);
  v_is_active boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_store_id IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_product_payload' USING ERRCODE = '22023';
  END IF;

  SELECT s.org_id
  INTO v_org_id
  FROM public.stores s
  WHERE s.id = p_store_id
    AND s.is_active = true;

  IF v_org_id IS NULL
    OR NOT public.user_has_org_role(
      p_store_id,
      ARRAY['admin', 'manager']::public.member_role[]
    )
  THEN
    RAISE EXCEPTION 'forbidden_catalog' USING ERRCODE = '42501';
  END IF;

  v_sku := NULLIF(btrim(p_payload->>'sku'), '');
  v_name := NULLIF(btrim(p_payload->>'name'), '');
  v_barcode := NULLIF(btrim(p_payload->>'barcode'), '');

  IF v_sku IS NULL
    OR v_name IS NULL
    OR COALESCE(jsonb_typeof(p_payload->'unit_price') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'cost_price') <> 'string', true)
    OR (p_payload->>'unit_price') !~ '^(0|[1-9][0-9]{0,9})\.[0-9]{2}$'
    OR (p_payload->>'cost_price') !~ '^(0|[1-9][0-9]{0,9})\.[0-9]{2}$'
  THEN
    RAISE EXCEPTION 'invalid_product_payload' USING ERRCODE = '22023';
  END IF;
  IF length(v_sku) > 64 OR length(v_name) > 200 OR length(v_barcode) > 64 THEN
    RAISE EXCEPTION 'invalid_product_payload' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'is_active'
    AND COALESCE(jsonb_typeof(p_payload->'is_active') <> 'boolean', true)
  THEN
    RAISE EXCEPTION 'invalid_product_payload' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'category_id'
    AND COALESCE(jsonb_typeof(p_payload->'category_id') NOT IN ('string', 'null'), true)
  THEN
    RAISE EXCEPTION 'invalid_product_payload' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_unit_price := (p_payload->>'unit_price')::numeric(12, 2);
    v_cost_price := (p_payload->>'cost_price')::numeric(12, 2);
    v_is_active := COALESCE((p_payload->>'is_active')::boolean, true);
    v_category_id := NULLIF(p_payload->>'category_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_product_payload' USING ERRCODE = '22023';
  END;

  IF v_category_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.categories c
      WHERE c.id = v_category_id
        AND c.org_id = v_org_id
    )
  THEN
    RAISE EXCEPTION 'category_not_found' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.products (
    org_id,
    category_id,
    sku,
    name,
    unit_price,
    cost_price,
    barcode,
    is_active
  )
  VALUES (
    v_org_id,
    v_category_id,
    v_sku,
    v_name,
    v_unit_price,
    v_cost_price,
    v_barcode,
    v_is_active
  )
  RETURNING id INTO v_product_id;

  RETURN jsonb_build_object('id', v_product_id, 'sku', v_sku);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_product(
  p_store_id uuid,
  p_product_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_org_id uuid;
  v_category_id uuid;
  v_sku text;
  v_name text;
  v_unit_price numeric(12, 2);
  v_cost_price numeric(12, 2);
  v_is_active boolean;
  v_updated_id uuid;
  v_updated_sku text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_store_id IS NULL
    OR p_product_id IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_product_payload' USING ERRCODE = '22023';
  END IF;
  IF NOT (
    p_payload ?| ARRAY[
      'sku', 'name', 'unit_price', 'cost_price', 'barcode', 'is_active', 'category_id'
    ]
  )
  THEN
    RAISE EXCEPTION 'empty_product_patch' USING ERRCODE = '22023';
  END IF;

  SELECT s.org_id
  INTO v_org_id
  FROM public.stores s
  WHERE s.id = p_store_id
    AND s.is_active = true;

  IF v_org_id IS NULL
    OR NOT public.user_has_org_role(
      p_store_id,
      ARRAY['admin', 'manager']::public.member_role[]
    )
  THEN
    RAISE EXCEPTION 'forbidden_catalog' USING ERRCODE = '42501';
  END IF;

  IF p_payload ? 'sku' THEN
    v_sku := NULLIF(btrim(p_payload->>'sku'), '');
    IF v_sku IS NULL OR length(v_sku) > 64 THEN
      RAISE EXCEPTION 'invalid_product_payload' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_payload ? 'name' THEN
    v_name := NULLIF(btrim(p_payload->>'name'), '');
    IF v_name IS NULL OR length(v_name) > 200 THEN
      RAISE EXCEPTION 'invalid_product_payload' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_payload ? 'barcode' THEN
    IF COALESCE(jsonb_typeof(p_payload->'barcode') NOT IN ('string', 'null'), true)
      OR length(NULLIF(btrim(p_payload->>'barcode'), '')) > 64
    THEN
      RAISE EXCEPTION 'invalid_product_payload' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_payload ? 'unit_price'
    AND (
      COALESCE(jsonb_typeof(p_payload->'unit_price') <> 'string', true)
      OR (p_payload->>'unit_price') !~ '^(0|[1-9][0-9]{0,9})\.[0-9]{2}$'
    )
  THEN
    RAISE EXCEPTION 'invalid_product_payload' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'cost_price'
    AND (
      COALESCE(jsonb_typeof(p_payload->'cost_price') <> 'string', true)
      OR (p_payload->>'cost_price') !~ '^(0|[1-9][0-9]{0,9})\.[0-9]{2}$'
    )
  THEN
    RAISE EXCEPTION 'invalid_product_payload' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'is_active'
    AND COALESCE(jsonb_typeof(p_payload->'is_active') <> 'boolean', true)
  THEN
    RAISE EXCEPTION 'invalid_product_payload' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'category_id'
    AND COALESCE(jsonb_typeof(p_payload->'category_id') NOT IN ('string', 'null'), true)
  THEN
    RAISE EXCEPTION 'invalid_product_payload' USING ERRCODE = '22023';
  END IF;

  BEGIN
    IF p_payload ? 'unit_price' THEN
      v_unit_price := (p_payload->>'unit_price')::numeric(12, 2);
    END IF;
    IF p_payload ? 'cost_price' THEN
      v_cost_price := (p_payload->>'cost_price')::numeric(12, 2);
    END IF;
    IF p_payload ? 'is_active' THEN
      v_is_active := (p_payload->>'is_active')::boolean;
    END IF;
    IF p_payload ? 'category_id' THEN
      v_category_id := NULLIF(p_payload->>'category_id', '')::uuid;
    END IF;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_product_payload' USING ERRCODE = '22023';
  END;

  IF v_category_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.categories c
      WHERE c.id = v_category_id
        AND c.org_id = v_org_id
    )
  THEN
    RAISE EXCEPTION 'category_not_found' USING ERRCODE = '22023';
  END IF;

  UPDATE public.products p
  SET
    sku = CASE WHEN p_payload ? 'sku' THEN v_sku ELSE p.sku END,
    name = CASE WHEN p_payload ? 'name' THEN v_name ELSE p.name END,
    unit_price = CASE WHEN p_payload ? 'unit_price' THEN v_unit_price ELSE p.unit_price END,
    cost_price = CASE WHEN p_payload ? 'cost_price' THEN v_cost_price ELSE p.cost_price END,
    barcode = CASE WHEN p_payload ? 'barcode' THEN NULLIF(btrim(p_payload->>'barcode'), '') ELSE p.barcode END,
    is_active = CASE WHEN p_payload ? 'is_active' THEN v_is_active ELSE p.is_active END,
    category_id = CASE WHEN p_payload ? 'category_id' THEN v_category_id ELSE p.category_id END,
    updated_at = now()
  WHERE p.id = p_product_id
    AND p.org_id = v_org_id
  RETURNING p.id, p.sku
  INTO v_updated_id, v_updated_sku;

  IF v_updated_id IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('id', v_updated_id, 'sku', v_updated_sku);
END;
$$;

REVOKE ALL ON FUNCTION public.create_product(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_product(uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.update_product(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_product(uuid, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_product(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_product(uuid, uuid, jsonb) TO authenticated;

-- Ensure every public SECURITY DEFINER function has a fixed resolution path,
-- including definitions inherited from earlier migrations.
DO $$
DECLARE
  v_function regprocedure;
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prosecdef
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path = pg_catalog, public, pg_temp',
      v_function
    );
  END LOOP;
END;
$$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- Client store role can register catalog products. Cost stays hidden and is not written by that role.
-- Stock movements stay admin/manager.

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
      ARRAY['admin', 'manager', 'client']::public.member_role[]
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

  IF public.user_has_org_role(
       p_store_id,
       ARRAY['client']::public.member_role[]
     )
     AND NOT public.user_has_org_role(
       p_store_id,
       ARRAY['admin', 'manager']::public.member_role[]
     )
  THEN
    v_cost_price := 0.00;
  END IF;

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
  v_lock_cost boolean := false;
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
      ARRAY['admin', 'manager', 'client']::public.member_role[]
    )
  THEN
    RAISE EXCEPTION 'forbidden_catalog' USING ERRCODE = '42501';
  END IF;

  v_lock_cost := public.user_has_org_role(
      p_store_id,
      ARRAY['client']::public.member_role[]
    )
    AND NOT public.user_has_org_role(
      p_store_id,
      ARRAY['admin', 'manager']::public.member_role[]
    );

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
    cost_price = CASE
      WHEN v_lock_cost THEN p.cost_price
      WHEN p_payload ? 'cost_price' THEN v_cost_price
      ELSE p.cost_price
    END,
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


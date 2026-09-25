-- Manual SQL for the LIVE schema.
-- Paste this in the SQL editor with a privileged database role.
-- Do not add this file to the 20250901* migration chain.
--
-- NON-EXECUTABLE ARCHIVE: the live schema below is incompatible with the
-- canonical schema. Use the migration chain instead.
/*
-- LIVE tables used here:
--   products(id, store_id, name, price, stock, created_at)
--   sales(id, store_id, total, payment_method, status, created_at)
--   sale_items(id, sale_id, product_id, product_name, quantity,
--              unit_price, unit_cost, total_price)
--
-- The function preserves an existing sale id by returning it as a replay.
-- Products are created only as a local stub and stock is not decremented here.

CREATE OR REPLACE FUNCTION public.process_sale(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_store_id uuid := NULLIF(p_payload->>'store_id', '')::uuid;
  v_sale_id uuid := NULLIF(p_payload->>'sale_id', '')::uuid;
  v_total numeric(12, 2) := 0;
  v_discount numeric(12, 2) := COALESCE(NULLIF(p_payload->>'discount', '')::numeric, 0);
  v_payment_total numeric(12, 2) := 0;
  v_payment jsonb;
  v_item jsonb;
  v_product_id uuid;
  v_product_name text;
  v_quantity numeric(12, 3);
  v_unit_price numeric(12, 2);
  v_item_discount numeric(12, 2);
  v_item_total numeric(12, 2);
  v_existing_store_id uuid;
  v_existing_status text;
  v_existing_total numeric(12, 2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'store_id_required' USING ERRCODE = '22023';
  END IF;

  IF p_payload->'items' IS NULL
     OR jsonb_typeof(p_payload->'items') <> 'array'
     OR jsonb_array_length(p_payload->'items') = 0 THEN
    RAISE EXCEPTION 'empty_items' USING ERRCODE = '22023';
  END IF;

  IF p_payload->'payments' IS NULL
     OR jsonb_typeof(p_payload->'payments') <> 'array'
     OR jsonb_array_length(p_payload->'payments') = 0 THEN
    RAISE EXCEPTION 'empty_payments' USING ERRCODE = '22023';
  END IF;

  IF v_sale_id IS NULL THEN
    v_sale_id := gen_random_uuid();
  ELSE
    SELECT s.store_id, s.status, s.total
    INTO v_existing_store_id, v_existing_status, v_existing_total
    FROM public.sales AS s
    WHERE s.id = v_sale_id;

    IF FOUND THEN
      IF v_existing_store_id <> v_store_id THEN
        RAISE EXCEPTION 'sale_store_mismatch' USING ERRCODE = '42501';
      END IF;

      RETURN jsonb_build_object(
        'sale_id', v_sale_id,
        'replay', true,
        'status', v_existing_status,
        'total', v_existing_total
      );
    END IF;
  END IF;

  FOR v_payment IN
    SELECT value
    FROM jsonb_array_elements(p_payload->'payments') AS payment(value)
  LOOP
    IF COALESCE(v_payment->>'method', '') <> 'cash' THEN
      RAISE EXCEPTION 'payment_method_not_configured' USING ERRCODE = '22023';
    END IF;

    v_payment_total := v_payment_total
      + COALESCE(NULLIF(v_payment->>'amount', '')::numeric, 0);
  END LOOP;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_payload->'items') AS item(value)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
    v_quantity := NULLIF(v_item->>'quantity', '')::numeric(12, 3);
    v_unit_price := NULLIF(v_item->>'unit_price', '')::numeric(12, 2);
    v_item_discount := COALESCE(NULLIF(v_item->>'discount', '')::numeric, 0);

    IF v_product_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'invalid_item' USING ERRCODE = '22023';
    END IF;

    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'invalid_unit_price' USING ERRCODE = '22023';
    END IF;

    v_item_total := round((v_quantity * v_unit_price) - v_item_discount, 2);
    IF v_item_total < 0 THEN
      RAISE EXCEPTION 'invalid_item_total' USING ERRCODE = '22023';
    END IF;

    v_total := v_total + v_item_total;

    INSERT INTO public.products (id, store_id, name, price, stock)
    VALUES (v_product_id, v_store_id, 'Stub Local', v_unit_price, 0)
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  v_total := round(v_total - v_discount, 2);
  IF v_total < 0 THEN
    RAISE EXCEPTION 'invalid_total' USING ERRCODE = '22023';
  END IF;

  IF v_payment_total <> v_total THEN
    RAISE EXCEPTION 'payment_total_mismatch' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.sales (id, store_id, total, payment_method, status, created_at)
  VALUES (v_sale_id, v_store_id, v_total, 'cash', 'confirmed', now())
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_sale_id;

  IF NOT FOUND THEN
    SELECT s.store_id, s.status, s.total
    INTO v_existing_store_id, v_existing_status, v_existing_total
    FROM public.sales AS s
    WHERE s.id = v_sale_id;

    IF v_existing_store_id <> v_store_id THEN
      RAISE EXCEPTION 'sale_store_mismatch' USING ERRCODE = '42501';
    END IF;

    RETURN jsonb_build_object(
      'sale_id', v_sale_id,
      'replay', true,
      'status', v_existing_status,
      'total', v_existing_total
    );
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_payload->'items') AS item(value)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
    v_quantity := NULLIF(v_item->>'quantity', '')::numeric(12, 3);
    v_unit_price := NULLIF(v_item->>'unit_price', '')::numeric(12, 2);
    v_item_discount := COALESCE(NULLIF(v_item->>'discount', '')::numeric, 0);
    v_item_total := round((v_quantity * v_unit_price) - v_item_discount, 2);

    SELECT p.name
    INTO v_product_name
    FROM public.products AS p
    WHERE p.id = v_product_id
      AND p.store_id = v_store_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_store_mismatch' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.sale_items (
      id,
      sale_id,
      product_id,
      product_name,
      quantity,
      unit_price,
      unit_cost,
      total_price
    )
    VALUES (
      gen_random_uuid(),
      v_sale_id,
      v_product_id,
      v_product_name,
      v_quantity,
      v_unit_price,
      0,
      v_item_total
    );
  END LOOP;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'replay', false,
    'status', 'confirmed',
    'total', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_sale(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_sale(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_sale(jsonb) TO authenticated;
*/

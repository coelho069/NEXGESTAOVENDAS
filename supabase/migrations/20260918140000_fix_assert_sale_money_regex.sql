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
  IF (
    (SELECT auth.uid()) IS NULL
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
  ) THEN
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
      OR (p_payload->>'discount') !~ '^(0|[1-9][0-9]{0,9})[.][0-9]{2}$'
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

    IF (v_item->>'unit_price') !~ '^(0|[1-9][0-9]{0,9})[.][0-9]{2}$'
      OR (
        v_item ? 'discount'
        AND (v_item->>'discount') !~ '^(0|[1-9][0-9]{0,9})[.][0-9]{2}$'
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
    OR (p_payload->'payments'->0->>'method') NOT IN ('cash', 'pix_manual')
    OR COALESCE(jsonb_typeof((p_payload->'payments')->0->'amount') <> 'string', true)
    OR (p_payload->'payments'->0->>'amount') !~ '^(0|[1-9][0-9]{0,9})[.][0-9]{2}$'
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

-- process_sale_core: allow cash and pix_manual (provider rails stay outside this RPC).

REVOKE ALL ON FUNCTION public.assert_sale_payload_integrity(jsonb) FROM PUBLIC;

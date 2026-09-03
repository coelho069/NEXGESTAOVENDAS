-- Sprint 1: transactional sale processing with idempotency and inventory locking

CREATE OR REPLACE FUNCTION public.process_sale(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_store_id uuid := NULLIF(p_payload->>'store_id', '')::uuid;
  v_client_mutation_id uuid := NULLIF(p_payload->>'client_mutation_id', '')::uuid;
  v_customer_id uuid := NULLIF(p_payload->>'customer_id', '')::uuid;
  v_existing_sale_id uuid;
  v_sale_id uuid;
  v_org_id uuid;
  v_subtotal numeric(12, 2) := 0;
  v_discount numeric(12, 2) := COALESCE((p_payload->>'discount')::numeric(12, 2), 0);
  v_total numeric(12, 2);
  v_item jsonb;
  v_product public.products%ROWTYPE;
  v_qty numeric(12, 3);
  v_unit_price numeric(12, 2);
  v_item_discount numeric(12, 2);
  v_item_total numeric(12, 2);
  v_balance numeric(12, 3);
  v_payment jsonb;
  v_payments_total numeric(12, 2) := 0;
  v_payment_method public.payment_method;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF v_store_id IS NULL OR v_client_mutation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;

  IF NOT public.user_has_store_access(v_store_id) THEN
    RAISE EXCEPTION 'store_access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT org_id INTO v_org_id FROM public.stores WHERE id = v_store_id AND is_active = true;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'store_not_found' USING ERRCODE = '22023';
  END IF;

  SELECT s.id INTO v_existing_sale_id
  FROM public.sales s
  WHERE s.store_id = v_store_id
    AND s.client_mutation_id = v_client_mutation_id;

  IF v_existing_sale_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'sale_id', v_existing_sale_id,
      'replay', true,
      'status', 'confirmed'
    );
  END IF;

  IF p_payload->'items' IS NULL OR jsonb_typeof(p_payload->'items') <> 'array'
     OR jsonb_array_length(p_payload->'items') = 0 THEN
    RAISE EXCEPTION 'empty_items' USING ERRCODE = '22023';
  END IF;

  IF p_payload->'payments' IS NULL OR jsonb_typeof(p_payload->'payments') <> 'array'
     OR jsonb_array_length(p_payload->'payments') = 0 THEN
    RAISE EXCEPTION 'empty_payments' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_payload->'items') AS t(value)
    ORDER BY (value->>'product_id')
  LOOP
    v_qty := (v_item->>'quantity')::numeric(12, 3);
    v_unit_price := (v_item->>'unit_price')::numeric(12, 2);
    v_item_discount := COALESCE((v_item->>'discount')::numeric(12, 2), 0);

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_product
    FROM public.products
    WHERE id = (v_item->>'product_id')::uuid
      AND org_id = v_org_id
      AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_found' USING ERRCODE = '22023';
    END IF;

    IF v_product.unit_price <> v_unit_price THEN
      RAISE EXCEPTION 'price_mismatch' USING ERRCODE = '22023';
    END IF;

    v_item_total := round((v_qty * v_unit_price) - v_item_discount, 2);
    IF v_item_total < 0 THEN
      RAISE EXCEPTION 'invalid_item_total' USING ERRCODE = '22023';
    END IF;

    v_subtotal := v_subtotal + v_item_total;
  END LOOP;

  v_total := round(v_subtotal - v_discount, 2);
  IF v_total < 0 THEN
    RAISE EXCEPTION 'invalid_total' USING ERRCODE = '22023';
  END IF;

  FOR v_payment IN SELECT value FROM jsonb_array_elements(p_payload->'payments') AS t(value)
  LOOP
    v_payment_method := (v_payment->>'method')::public.payment_method;

    IF v_payment_method <> 'cash'::public.payment_method THEN
      RAISE EXCEPTION 'payment_method_not_configured' USING ERRCODE = '22023';
    END IF;

    v_payments_total := v_payments_total + (v_payment->>'amount')::numeric(12, 2);
  END LOOP;

  IF v_payments_total <> v_total THEN
    RAISE EXCEPTION 'payment_total_mismatch' USING ERRCODE = '22023';
  END IF;

  IF v_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = v_customer_id AND c.org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.inventory_balances ib
  JOIN jsonb_array_elements(p_payload->'items') AS t(value)
    ON ib.product_id = (value->>'product_id')::uuid
  WHERE ib.store_id = v_store_id
  ORDER BY ib.product_id
  FOR UPDATE;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_payload->'items') AS t(value)
    ORDER BY (value->>'product_id')
  LOOP
    v_qty := (v_item->>'quantity')::numeric(12, 3);

    SELECT ib.quantity INTO v_balance
    FROM public.inventory_balances ib
    WHERE ib.store_id = v_store_id
      AND ib.product_id = (v_item->>'product_id')::uuid
    FOR UPDATE;

    IF NOT FOUND OR v_balance < v_qty THEN
      RAISE EXCEPTION 'insufficient_stock' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  INSERT INTO public.sales (
    org_id,
    store_id,
    customer_id,
    cashier_id,
    status,
    sync_status,
    client_mutation_id,
    subtotal,
    discount,
    total,
    confirmed_at
  )
  VALUES (
    v_org_id,
    v_store_id,
    v_customer_id,
    v_user_id,
    'confirmed',
    'synced',
    v_client_mutation_id,
    v_subtotal,
    v_discount,
    v_total,
    now()
  )
  RETURNING id INTO v_sale_id;

  INSERT INTO public.sale_idempotency_keys (store_id, client_mutation_id, sale_id)
  VALUES (v_store_id, v_client_mutation_id, v_sale_id);

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'items') AS t(value)
  LOOP
    v_qty := (v_item->>'quantity')::numeric(12, 3);
    v_unit_price := (v_item->>'unit_price')::numeric(12, 2);
    v_item_discount := COALESCE((v_item->>'discount')::numeric(12, 2), 0);
    v_item_total := round((v_qty * v_unit_price) - v_item_discount, 2);

    SELECT * INTO v_product
    FROM public.products
    WHERE id = (v_item->>'product_id')::uuid;

    INSERT INTO public.sale_items (
      sale_id,
      product_id,
      product_name,
      product_sku,
      quantity,
      unit_price,
      discount,
      total
    )
    VALUES (
      v_sale_id,
      v_product.id,
      v_product.name,
      v_product.sku,
      v_qty,
      v_unit_price,
      v_item_discount,
      v_item_total
    );

    UPDATE public.inventory_balances
    SET quantity = quantity - v_qty,
        updated_at = now()
    WHERE store_id = v_store_id
      AND product_id = v_product.id
    RETURNING quantity INTO v_balance;

    INSERT INTO public.inventory_movements (
      org_id,
      store_id,
      product_id,
      sale_id,
      movement_type,
      quantity_change,
      balance_after,
      created_by
    )
    VALUES (
      v_org_id,
      v_store_id,
      v_product.id,
      v_sale_id,
      'sale',
      -v_qty,
      v_balance,
      v_user_id
    );
  END LOOP;

  FOR v_payment IN SELECT value FROM jsonb_array_elements(p_payload->'payments') AS t(value)
  LOOP
    INSERT INTO public.payments (
      org_id,
      sale_id,
      method,
      status,
      amount,
      adapter_status
    )
    VALUES (
      v_org_id,
      v_sale_id,
      (v_payment->>'method')::public.payment_method,
      'captured',
      (v_payment->>'amount')::numeric(12, 2),
      'configured'
    );
  END LOOP;

  INSERT INTO public.fiscal_documents (org_id, sale_id, adapter, status)
  VALUES (v_org_id, v_sale_id, 'not_configured', 'not_configured');

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
    'sale',
    v_sale_id,
    'sale.confirmed',
    jsonb_build_object(
      'client_mutation_id', v_client_mutation_id,
      'total', v_total,
      'items_count', jsonb_array_length(p_payload->'items')
    )
  );

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'replay', false,
    'status', 'confirmed',
    'total', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_sale(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_sale(jsonb) TO authenticated;

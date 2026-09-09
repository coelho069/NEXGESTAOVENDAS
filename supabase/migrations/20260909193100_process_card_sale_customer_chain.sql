-- process_card_sale: honor store customer policy and reconcile ledger before decrement.
-- Does not enable PIX or change cash/card architecture.

CREATE OR REPLACE FUNCTION public.process_card_sale(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_client_mutation_id uuid;
  v_provider_ref text;
  v_org_id uuid;
  v_intent public.card_payment_intents%ROWTYPE;
  v_sale_payload jsonb;
  v_existing_sale_id uuid;
  v_sale_id uuid;
  v_customer_id uuid;
  v_discount numeric(12, 2);
  v_subtotal numeric(12, 2) := 0;
  v_total numeric(12, 2);
  v_item jsonb;
  v_product public.products%ROWTYPE;
  v_qty numeric(12, 3);
  v_unit_price numeric(12, 2);
  v_item_discount numeric(12, 2);
  v_item_total numeric(12, 2);
  v_balance numeric(12, 3);
  v_payment_id uuid;
  v_status text;
  v_sale_total numeric(12, 2);
  v_require_customer boolean := false;
  v_require_document boolean := false;
  v_customer_document text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_client_mutation_id := NULLIF(p_payload->>'client_mutation_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_card_sale' USING ERRCODE = '22023';
  END;

  v_provider_ref := NULLIF(btrim(p_payload->>'provider_ref'), '');

  IF v_store_id IS NULL
    OR v_client_mutation_id IS NULL
    OR v_provider_ref IS NULL
    OR v_provider_ref !~ '^pi_[A-Za-z0-9]+$'
  THEN
    RAISE EXCEPTION 'invalid_card_sale' USING ERRCODE = '22023';
  END IF;

  IF public.user_has_store_access(v_store_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'store_access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT org_id INTO v_org_id
  FROM public.stores
  WHERE id = v_store_id
    AND is_active IS TRUE;

  IF v_org_id IS NULL OR v_org_id IS DISTINCT FROM public.current_user_org_id() THEN
    RAISE EXCEPTION 'store_access_denied' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_store_id::text || ':' || v_client_mutation_id::text, 0)
  );

  SELECT *
  INTO v_intent
  FROM public.card_payment_intents
  WHERE org_id = v_org_id
    AND store_id = v_store_id
    AND client_mutation_id = v_client_mutation_id
    AND provider_ref = v_provider_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'card_payment_intent_not_found' USING ERRCODE = '42501';
  END IF;

  IF v_intent.status <> 'captured' THEN
    RAISE EXCEPTION 'card_payment_not_captured' USING ERRCODE = '22023';
  END IF;

  v_sale_payload := CASE
    WHEN jsonb_typeof(v_intent.sale_payload) = 'object' THEN v_intent.sale_payload
    ELSE p_payload
  END;
  IF NULLIF(v_sale_payload->>'customer_id', '') IS NULL
    AND NULLIF(p_payload->>'customer_id', '') IS NOT NULL THEN
    v_sale_payload := v_sale_payload || jsonb_build_object('customer_id', p_payload->>'customer_id');
  END IF;

  SELECT s.id, s.status::text, s.total
  INTO v_existing_sale_id, v_status, v_sale_total
  FROM public.sales s
  WHERE s.store_id = v_store_id
    AND s.client_mutation_id = v_client_mutation_id
  FOR UPDATE;

  IF v_existing_sale_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'sale_id', v_existing_sale_id,
      'client_mutation_id', v_client_mutation_id,
      'replay', true,
      'status', v_status,
      'total', v_sale_total,
      'stock_reconciled', true
    );
  END IF;

  v_customer_id := NULLIF(v_sale_payload->>'customer_id', '')::uuid;
  v_discount := COALESCE((v_sale_payload->>'discount')::numeric(12, 2), 0);

  IF v_sale_payload->'items' IS NULL
    OR jsonb_typeof(v_sale_payload->'items') <> 'array'
    OR jsonb_array_length(v_sale_payload->'items') = 0
  THEN
    RAISE EXCEPTION 'empty_items' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(v_sale_payload->'items') AS t(value)
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
  IF v_total < 0 OR v_total IS DISTINCT FROM v_intent.amount THEN
    RAISE EXCEPTION 'payment_total_mismatch' USING ERRCODE = '22023';
  END IF;

  PERFORM public.assert_sale_discount_cap(v_store_id, v_discount, v_subtotal);

  IF v_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = v_customer_id AND c.org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = '22023';
  END IF;

  IF to_regclass('public.store_settings') IS NOT NULL THEN
    EXECUTE
      'SELECT COALESCE(require_customer_on_sale, false), COALESCE(require_customer_document, false)
       FROM public.store_settings
       WHERE store_id = $1 AND org_id = $2'
      INTO v_require_customer, v_require_document
      USING v_store_id, v_org_id;
    IF v_require_customer AND v_customer_id IS NULL THEN
      RAISE EXCEPTION 'customer_required_on_sale' USING ERRCODE = '22023';
    END IF;
    IF v_require_document AND v_customer_id IS NOT NULL THEN
      SELECT NULLIF(btrim(COALESCE(c.document, '')), '')
      INTO v_customer_document
      FROM public.customers c
      WHERE c.id = v_customer_id AND c.org_id = v_org_id;
      IF v_customer_document IS NULL THEN
        RAISE EXCEPTION 'customer_document_required' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  PERFORM 1
  FROM public.inventory_balances ib
  JOIN jsonb_array_elements(v_sale_payload->'items') AS t(value)
    ON ib.product_id = (value->>'product_id')::uuid
  WHERE ib.store_id = v_store_id
  ORDER BY ib.product_id
  FOR UPDATE;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(v_sale_payload->'items') AS t(value)
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
    COALESCE(v_intent.operator_id, v_user_id),
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

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_sale_payload->'items') AS t(value)
  LOOP
    v_qty := (v_item->>'quantity')::numeric(12, 3);
    v_unit_price := (v_item->>'unit_price')::numeric(12, 2);
    v_item_discount := COALESCE((v_item->>'discount')::numeric(12, 2), 0);
    v_item_total := round((v_qty * v_unit_price) - v_item_discount, 2);

    SELECT * INTO v_product
    FROM public.products
    WHERE id = (v_item->>'product_id')::uuid;

    PERFORM public.reconcile_inventory_movement_chain(
      v_org_id,
      v_store_id,
      v_product.id,
      COALESCE(v_intent.operator_id, v_user_id)
    );

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
      created_by,
      reason
    )
    VALUES (
      v_org_id,
      v_store_id,
      v_product.id,
      v_sale_id,
      'sale',
      -v_qty,
      v_balance,
      COALESCE(v_intent.operator_id, v_user_id),
      'card_sale_captured'
    );
  END LOOP;

  INSERT INTO public.payments (
    org_id,
    store_id,
    sale_id,
    method,
    status,
    amount,
    adapter_status,
    external_reference,
    client_mutation_id,
    reconciled_at
  )
  VALUES (
    v_org_id,
    v_store_id,
    v_sale_id,
    'card',
    'captured',
    v_total,
    'configured',
    v_provider_ref,
    v_client_mutation_id,
    now()
  )
  RETURNING id INTO v_payment_id;

  UPDATE public.card_payment_intents
  SET
    sale_id = v_sale_id,
    payment_id = v_payment_id,
    updated_at = now()
  WHERE id = v_intent.id;

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
      'provider_ref', v_provider_ref,
      'method', 'card'
    )
  );

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'client_mutation_id', v_client_mutation_id,
    'replay', false,
    'status', 'confirmed',
    'total', v_total,
    'stock_reconciled', true,
    'provider_ref', v_provider_ref
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_card_sale(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_card_sale(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_card_sale(jsonb) TO authenticated;

-- PDV direct checkout: pix_manual mirrors cash (confirmed/synced, no provider_ref).

ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'pix_manual';

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
    OR (p_payload->'payments'->0->>'method') NOT IN ('cash', 'pix_manual')
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

-- process_sale_core: allow cash and pix_manual (provider rails stay outside this RPC).
CREATE OR REPLACE FUNCTION public.process_sale_core(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
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

    IF v_payment_method NOT IN (
      'cash'::public.payment_method,
      'pix_manual'::public.payment_method
    ) THEN
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

REVOKE ALL ON FUNCTION public.process_sale_core(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_sale_core(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.process_sale_core(jsonb) FROM authenticated;

CREATE OR REPLACE FUNCTION public.process_sale_with_cash(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_session_id uuid;
  v_terminal_id uuid;
  v_client_mutation_id uuid;
  v_org_id uuid;
  v_result jsonb;
  v_session public.cash_sessions%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_movement public.cash_movements%ROWTYPE;
BEGIN
  IF v_user_id IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
    OR COALESCE(jsonb_typeof(p_payload->'store_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'cash_session_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'terminal_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'client_mutation_id') <> 'string', true)
  THEN
    RAISE EXCEPTION 'invalid_cash_sale_payload' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_session_id := NULLIF(p_payload->>'cash_session_id', '')::uuid;
    v_terminal_id := NULLIF(p_payload->>'terminal_id', '')::uuid;
    v_client_mutation_id := NULLIF(p_payload->>'client_mutation_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_cash_sale_payload' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'forbidden_cash' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      v_org_id::text || ':' || v_store_id::text
        || ':cash-sale:' || v_session_id::text,
      0
    )
  );

  SELECT s.*
  INTO v_session
  FROM public.cash_sessions s
  WHERE s.id = v_session_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_session.org_id IS DISTINCT FROM v_org_id
    OR v_session.store_id IS DISTINCT FROM v_store_id
    OR v_session.terminal_id IS DISTINCT FROM v_terminal_id
  THEN
    RAISE EXCEPTION 'cash_session_closed' USING ERRCODE = '40901';
  END IF;

  IF v_session.status <> 'open' THEN
    SELECT *
    INTO v_sale
    FROM public.sales s
    WHERE s.store_id = v_store_id
      AND s.client_mutation_id = v_client_mutation_id
    FOR UPDATE;

    IF NOT FOUND
      OR v_sale.cash_session_id IS DISTINCT FROM v_session_id
    THEN
      RAISE EXCEPTION 'cash_session_closed' USING ERRCODE = '40901';
    END IF;

    SELECT *
    INTO v_payment
    FROM public.payments p
    WHERE p.sale_id = v_sale.id
    ORDER BY p.id
    LIMIT 1;

    IF v_payment.method = 'cash'::public.payment_method THEN
      SELECT *
      INTO v_movement
      FROM public.cash_movements cm
      WHERE cm.sale_id = v_sale.id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'cash_sale_not_reconciled'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'sale_id', v_sale.id,
      'client_mutation_id', v_sale.client_mutation_id,
      'replay', true,
      'status', v_sale.status,
      'total', v_sale.total,
      'stock_reconciled', true,
      'cash_session_id', v_session_id,
      'terminal_id', v_terminal_id
    );
  END IF;

  v_result := public.process_sale(
    p_payload - 'cash_session_id' - 'terminal_id'
  );

  IF v_result->>'sale_id' IS NULL THEN
    RAISE EXCEPTION 'cash_sale_missing_sale' USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO v_sale
  FROM public.sales s
  WHERE s.id = (v_result->>'sale_id')::uuid
  FOR UPDATE;

  IF v_result->>'replay' = 'true' THEN
    IF v_sale.cash_session_id IS DISTINCT FROM v_session_id THEN
      RAISE EXCEPTION 'cash_sale_session_mismatch'
        USING ERRCODE = '23514';
    END IF;

    SELECT *
    INTO v_payment
    FROM public.payments p
    WHERE p.sale_id = v_sale.id
    ORDER BY p.id
    LIMIT 1;

    IF v_payment.method = 'cash'::public.payment_method THEN
      SELECT *
      INTO v_movement
      FROM public.cash_movements cm
      WHERE cm.sale_id = v_sale.id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'cash_sale_not_reconciled'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    RETURN v_result
      || jsonb_build_object(
        'cash_session_id', v_session_id,
        'terminal_id', v_terminal_id
      );
  END IF;

  UPDATE public.sales
  SET cash_session_id = v_session_id
  WHERE id = v_sale.id
    AND org_id = v_org_id
    AND store_id = v_store_id;

  SELECT *
  INTO v_payment
  FROM public.payments p
  WHERE p.sale_id = v_sale.id
    AND p.org_id = v_org_id
    AND p.store_id = v_store_id
    AND p.method IN (
      'cash'::public.payment_method,
      'pix_manual'::public.payment_method
    )
  ORDER BY p.id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cash_sale_missing_payment'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.payments
  SET cash_session_id = v_session_id
  WHERE id = v_payment.id;

  IF v_payment.method = 'cash'::public.payment_method THEN
    INSERT INTO public.cash_movements (
      cash_session_id,
      org_id,
      store_id,
      terminal_id,
      movement_type,
      amount,
      reason,
      created_by,
      client_mutation_id,
      sale_id,
      payment_id
    )
    VALUES (
      v_session_id,
      v_org_id,
      v_store_id,
      v_terminal_id,
      'sale_cash',
      v_payment.amount,
      'Venda em dinheiro',
      v_user_id,
      v_sale.client_mutation_id,
      v_sale.id,
      v_payment.id
    )
    RETURNING *
    INTO v_movement;

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
      'cash_movement',
      v_movement.id,
      'cash.sale_captured',
      jsonb_build_object(
        'cash_session_id', v_session_id,
        'sale_id', v_sale.id,
        'payment_id', v_payment.id,
        'amount', v_payment.amount,
        'client_mutation_id', v_sale.client_mutation_id
      )
    );
  END IF;

  RETURN v_result
    || jsonb_build_object(
      'cash_session_id', v_session_id,
      'terminal_id', v_terminal_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.process_sale_with_cash(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_sale_with_cash(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_sale_with_cash(jsonb) TO authenticated;

-- Hardening backfill: provider-ref helper predates search_path pin (unchanged semantics).
CREATE OR REPLACE FUNCTION public.is_valid_pix_provider_ref(p_ref text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT p_ref ~ '^pi_[A-Za-z0-9]+$' OR p_ref ~ '^ORD[A-Z0-9]+$';
$$;

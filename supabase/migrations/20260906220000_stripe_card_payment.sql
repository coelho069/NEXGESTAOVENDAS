-- Stripe card payments (testmode): authorize ≠ confirmed sale.
-- Cash RPCs, cash sessions and cash movements are untouched.
-- Card refunds stay payment_refund_status=pending_external until webhook/reconcile.
-- Never invent refund_cash for card.

CREATE TABLE IF NOT EXISTS public.card_payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  client_mutation_id uuid NOT NULL,
  provider_ref text NOT NULL CHECK (provider_ref ~ '^pi_[A-Za-z0-9]+$'),
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'brl' CHECK (currency = 'brl'),
  status text NOT NULL CHECK (
    status IN ('pending', 'authorized', 'captured', 'failed', 'unknown', 'cancelled', 'refunded')
  ),
  operator_id uuid NOT NULL,
  sale_id uuid,
  payment_id uuid,
  sale_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT card_payment_intents_store_scope_fk
    FOREIGN KEY (store_id, org_id)
    REFERENCES public.stores (id, org_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS card_payment_intents_mutation_key
  ON public.card_payment_intents (org_id, store_id, client_mutation_id);

CREATE UNIQUE INDEX IF NOT EXISTS card_payment_intents_provider_ref_key
  ON public.card_payment_intents (provider_ref);

CREATE TABLE IF NOT EXISTS public.card_provider_events (
  event_id text PRIMARY KEY CHECK (length(btrim(event_id)) BETWEEN 1 AND 200),
  org_id uuid REFERENCES public.organizations (id) ON DELETE CASCADE,
  store_id uuid REFERENCES public.stores (id) ON DELETE CASCADE,
  provider_ref text NOT NULL,
  event_type text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS card_provider_events_provider_ref_idx
  ON public.card_provider_events (provider_ref, created_at DESC);

ALTER TABLE public.card_payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.card_provider_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS card_payment_intents_deny ON public.card_payment_intents;
CREATE POLICY card_payment_intents_deny
  ON public.card_payment_intents
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS card_provider_events_deny ON public.card_provider_events;
CREATE POLICY card_provider_events_deny
  ON public.card_provider_events
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.card_payment_intents FROM PUBLIC;
REVOKE ALL ON TABLE public.card_payment_intents FROM anon;
REVOKE ALL ON TABLE public.card_payment_intents FROM authenticated;
REVOKE ALL ON TABLE public.card_provider_events FROM PUBLIC;
REVOKE ALL ON TABLE public.card_provider_events FROM anon;
REVOKE ALL ON TABLE public.card_provider_events FROM authenticated;

CREATE OR REPLACE FUNCTION public.register_card_payment_intent(p_payload jsonb)
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
  v_amount numeric(12, 2);
  v_status text;
  v_org_id uuid;
  v_existing public.card_payment_intents%ROWTYPE;
  v_row public.card_payment_intents%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_client_mutation_id := NULLIF(p_payload->>'client_mutation_id', '')::uuid;
    v_amount := (p_payload->>'amount')::numeric(12, 2);
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_card_payment_intent' USING ERRCODE = '22023';
  END;

  v_provider_ref := NULLIF(btrim(p_payload->>'provider_ref'), '');
  v_status := lower(NULLIF(btrim(p_payload->>'status'), ''));

  IF v_store_id IS NULL
    OR v_client_mutation_id IS NULL
    OR v_provider_ref IS NULL
    OR v_provider_ref !~ '^pi_[A-Za-z0-9]+$'
    OR v_amount IS NULL
    OR v_amount <= 0
    OR v_status NOT IN ('pending', 'authorized', 'failed', 'unknown', 'cancelled')
  THEN
    RAISE EXCEPTION 'invalid_card_payment_intent' USING ERRCODE = '22023';
  END IF;

  IF public.user_has_store_access(v_store_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'payment_access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT org_id INTO v_org_id
  FROM public.stores
  WHERE id = v_store_id
    AND is_active IS TRUE;

  IF v_org_id IS NULL OR v_org_id IS DISTINCT FROM public.current_user_org_id() THEN
    RAISE EXCEPTION 'payment_access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.card_payment_intents
  WHERE org_id = v_org_id
    AND store_id = v_store_id
    AND client_mutation_id = v_client_mutation_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.provider_ref IS DISTINCT FROM v_provider_ref
      OR v_existing.amount IS DISTINCT FROM v_amount
    THEN
      RAISE EXCEPTION 'card_payment_intent_mismatch' USING ERRCODE = '22023';
    END IF;
    IF v_existing.status IN ('captured', 'refunded') THEN
      RETURN jsonb_build_object(
        'id', v_existing.id,
        'provider_ref', v_existing.provider_ref,
        'status', v_existing.status,
        'replay', true
      );
    END IF;
    UPDATE public.card_payment_intents
    SET
      status = v_status,
      sale_payload = COALESCE(p_payload->'sale_payload', sale_payload),
      updated_at = now()
    WHERE id = v_existing.id
    RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.card_payment_intents (
      org_id,
      store_id,
      client_mutation_id,
      provider_ref,
      amount,
      currency,
      status,
      operator_id,
      sale_payload
    )
    VALUES (
      v_org_id,
      v_store_id,
      v_client_mutation_id,
      v_provider_ref,
      v_amount,
      'brl',
      v_status,
      v_user_id,
      COALESCE(p_payload->'sale_payload', '{}'::jsonb)
    )
    RETURNING * INTO v_row;
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'provider_ref', v_row.provider_ref,
    'status', v_row.status,
    'replay', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_card_provider_status(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_provider_ref text;
  v_status text;
  v_row public.card_payment_intents%ROWTYPE;
BEGIN
  v_provider_ref := NULLIF(btrim(p_payload->>'provider_ref'), '');
  v_status := lower(NULLIF(btrim(p_payload->>'status'), ''));

  IF v_provider_ref IS NULL
    OR v_provider_ref !~ '^pi_[A-Za-z0-9]+$'
    OR v_status NOT IN ('authorized', 'captured', 'failed', 'unknown', 'cancelled', 'refunded')
  THEN
    RAISE EXCEPTION 'invalid_card_provider_status' USING ERRCODE = '22023';
  END IF;

  UPDATE public.card_payment_intents
  SET
    status = v_status,
    updated_at = now()
  WHERE provider_ref = v_provider_ref
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'card_payment_intent_not_found' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'provider_ref', v_row.provider_ref,
    'status', v_row.status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_card_provider_event(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_event_id text;
  v_event_type text;
  v_provider_ref text;
  v_status text;
  v_intent public.card_payment_intents%ROWTYPE;
  v_existing public.card_provider_events%ROWTYPE;
BEGIN
  v_event_id := NULLIF(btrim(p_payload->>'event_id'), '');
  v_event_type := NULLIF(btrim(p_payload->>'event_type'), '');
  v_provider_ref := NULLIF(btrim(p_payload->>'provider_ref'), '');
  v_status := lower(NULLIF(btrim(p_payload->>'status'), ''));

  IF v_event_id IS NULL OR v_event_type IS NULL OR v_provider_ref IS NULL THEN
    RAISE EXCEPTION 'invalid_card_provider_event' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.card_provider_events
  WHERE event_id = v_event_id
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'event_id', v_existing.event_id,
      'provider_ref', v_existing.provider_ref,
      'status', v_existing.status,
      'replay', true
    );
  END IF;

  SELECT *
  INTO v_intent
  FROM public.card_payment_intents
  WHERE provider_ref = v_provider_ref
  FOR UPDATE;

  INSERT INTO public.card_provider_events (
    event_id,
    org_id,
    store_id,
    provider_ref,
    event_type,
    status
  )
  VALUES (
    v_event_id,
    v_intent.org_id,
    v_intent.store_id,
    v_provider_ref,
    v_event_type,
    COALESCE(v_status, 'unknown')
  );

  IF v_intent.id IS NOT NULL AND v_status IS NOT NULL THEN
    UPDATE public.card_payment_intents
    SET
      status = v_status,
      updated_at = now()
    WHERE id = v_intent.id;

    IF v_intent.payment_id IS NOT NULL AND v_status IN ('authorized', 'captured', 'failed', 'cancelled', 'refunded') THEN
      PERFORM public.record_payment_provider_event(jsonb_build_object(
        'payment_id', v_intent.payment_id,
        'store_id', v_intent.store_id,
        'event_id', v_event_id,
        'status', v_status,
        'provider_reference', v_provider_ref
      ));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'event_id', v_event_id,
    'provider_ref', v_provider_ref,
    'status', COALESCE(v_status, 'unknown'),
    'replay', false
  );
END;
$$;

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

CREATE OR REPLACE FUNCTION public.complete_card_refund(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_provider_ref text;
  v_event_id text;
  v_event_type text;
  v_intent public.card_payment_intents%ROWTYPE;
  v_return public.sale_returns%ROWTYPE;
  v_completed boolean := false;
BEGIN
  v_provider_ref := NULLIF(btrim(p_payload->>'provider_ref'), '');
  v_event_id := NULLIF(btrim(p_payload->>'event_id'), '');
  v_event_type := NULLIF(btrim(p_payload->>'event_type'), '');

  IF v_provider_ref IS NULL OR v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_card_refund' USING ERRCODE = '22023';
  END IF;

  -- Never insert refund_cash. Card refunds stay pending_external until a
  -- succeeded refund/charge.refunded event arrives.
  PERFORM public.apply_card_provider_event(jsonb_build_object(
    'event_id', v_event_id,
    'event_type', COALESCE(v_event_type, 'charge.refunded'),
    'provider_ref', v_provider_ref,
    'status', CASE
      WHEN v_event_type IN ('charge.refunded') THEN 'refunded'
      ELSE 'captured'
    END
  ));

  SELECT *
  INTO v_intent
  FROM public.card_payment_intents
  WHERE provider_ref = v_provider_ref
  FOR UPDATE;

  IF NOT FOUND OR v_intent.sale_id IS NULL THEN
    RETURN jsonb_build_object(
      'provider_ref', v_provider_ref,
      'payment_refund_status', 'pending_external',
      'completed', false
    );
  END IF;

  IF v_event_type IN ('charge.refunded')
    OR COALESCE(p_payload->>'refund_succeeded', '') = 'true'
  THEN
    UPDATE public.sale_returns
    SET payment_refund_status = 'completed'
    WHERE sale_id = v_intent.sale_id
      AND payment_method = 'card'
      AND payment_refund_status = 'pending_external'
    RETURNING * INTO v_return;
    v_completed := FOUND;
  END IF;

  RETURN jsonb_build_object(
    'provider_ref', v_provider_ref,
    'sale_id', v_intent.sale_id,
    'payment_refund_status', CASE WHEN v_completed THEN 'completed' ELSE 'pending_external' END,
    'completed', v_completed,
    'invented_refund_cash', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_card_payment_intent(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_card_payment_intent(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_card_payment_intent(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.process_card_sale(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_card_sale(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_card_sale(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.apply_card_provider_status(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_card_provider_status(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.apply_card_provider_status(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_card_provider_status(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.apply_card_provider_event(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_card_provider_event(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.apply_card_provider_event(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_card_provider_event(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.get_card_payment_intent(p_payload jsonb)
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
  v_row public.card_payment_intents%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_client_mutation_id := NULLIF(p_payload->>'client_mutation_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_card_payment_intent' USING ERRCODE = '22023';
  END;

  v_provider_ref := NULLIF(btrim(p_payload->>'provider_ref'), '');

  IF v_store_id IS NULL OR (v_client_mutation_id IS NULL AND v_provider_ref IS NULL) THEN
    RAISE EXCEPTION 'invalid_card_payment_intent' USING ERRCODE = '22023';
  END IF;

  IF public.user_has_store_access(v_store_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'payment_access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_row
  FROM public.card_payment_intents
  WHERE store_id = v_store_id
    AND org_id = public.current_user_org_id()
    AND (v_client_mutation_id IS NULL OR client_mutation_id = v_client_mutation_id)
    AND (v_provider_ref IS NULL OR provider_ref = v_provider_ref);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'card_payment_intent_not_found' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'provider_ref', v_row.provider_ref,
    'amount', v_row.amount,
    'status', v_row.status,
    'sale_id', v_row.sale_id,
    'client_mutation_id', v_row.client_mutation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_card_payment_intent(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_card_payment_intent(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_card_payment_intent(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.complete_card_refund(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_card_refund(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.complete_card_refund(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_card_refund(jsonb) TO service_role;

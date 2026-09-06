-- B20: forward cash_session_id into process_sale.
-- assert_store_sale_settings requires an explicit session id when
-- require_open_cash_session=true (no "any open session" fallback).
-- process_sale_with_cash previously stripped cash_session_id before delegating.

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
    INTO v_movement
    FROM public.cash_movements cm
    WHERE cm.sale_id = v_sale.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'cash_sale_not_reconciled'
        USING ERRCODE = '23514';
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
    -- Forward cash_session_id so assert_store_sale_settings validates the explicit session.
    p_payload - 'terminal_id'
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
    INTO v_movement
    FROM public.cash_movements cm
    WHERE cm.sale_id = v_sale.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'cash_sale_not_reconciled'
        USING ERRCODE = '23514';
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
    AND p.method = 'cash'
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

  RETURN v_result
    || jsonb_build_object(
      'cash_session_id', v_session_id,
      'terminal_id', v_terminal_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.open_cash_session(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.open_cash_session(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.open_cash_session(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.record_cash_movement(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_cash_movement(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_cash_movement(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.get_cash_session(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_cash_session(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_cash_session(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.close_cash_session(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_cash_session(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.close_cash_session(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.process_sale_with_cash(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_sale_with_cash(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_sale_with_cash(jsonb) TO authenticated;

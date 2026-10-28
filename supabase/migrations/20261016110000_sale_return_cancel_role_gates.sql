-- Remediação P0 (run-5, agente A, A2): cancel_sale e process_sale_return
-- aceitavam qualquer papel de loja (inclusive client) no banco; a rota já exige
-- canCancelSale (admin|manager) e canReturnSale (admin|manager|cashier).
-- Regra alinhada ao app (src/lib/domain/sale-return.ts). Mudança mínima: somente
-- a checagem de papel. Corpo copiado da definição vigente (20260905180000).
-- SECURITY DEFINER, search_path fixo e GRANT EXECUTE (authenticated) preservados.

CREATE OR REPLACE FUNCTION public.process_sale_return(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_role public.member_role;
  v_store_id uuid;
  v_sale_id uuid;
  v_terminal_id uuid;
  v_cash_session_id uuid;
  v_client_mutation_id uuid;
  v_operation text;
  v_reason text;
  v_notes text;
  v_org_id uuid;
  v_sale public.sales%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_existing public.sale_returns%ROWTYPE;
  v_return public.sale_returns%ROWTYPE;
  v_item jsonb;
  v_sale_item public.sale_items%ROWTYPE;
  v_qty numeric(12, 3);
  v_already_qty numeric(12, 3);
  v_line_total numeric(12, 2);
  v_line_discount numeric(12, 2);
  v_items_subtotal numeric(12, 2) := 0;
  v_header_share numeric(12, 2) := 0;
  v_refund_total numeric(12, 2) := 0;
  v_already_refunded numeric(12, 2) := 0;
  v_remaining_refundable numeric(12, 2);
  v_remaining_qty numeric(12, 3) := 0;
  v_balance numeric(12, 3);
  v_next_balance numeric(12, 3);
  v_next_status public.sale_status;
  v_payment_refund_status text;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_items jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_sale_return_payload' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_sale_id := NULLIF(p_payload->>'sale_id', '')::uuid;
    v_terminal_id := NULLIF(p_payload->>'terminal_id', '')::uuid;
    v_cash_session_id := NULLIF(p_payload->>'cash_session_id', '')::uuid;
    v_client_mutation_id := NULLIF(p_payload->>'client_mutation_id', '')::uuid;
    v_operation := NULLIF(btrim(COALESCE(p_payload->>'operation', '')), '');
    v_reason := NULLIF(btrim(COALESCE(p_payload->>'reason', '')), '');
    v_notes := NULLIF(btrim(COALESCE(p_payload->>'notes', '')), '');
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_sale_return_payload' USING ERRCODE = '22023';
  END;

  IF v_store_id IS NULL
    OR v_sale_id IS NULL
    OR v_terminal_id IS NULL
    OR v_client_mutation_id IS NULL
    OR v_operation IS NULL
    OR v_reason IS NULL
    OR jsonb_typeof(p_payload->'items') <> 'array'
    OR jsonb_array_length(p_payload->'items') < 1
  THEN
    RAISE EXCEPTION 'invalid_sale_return_payload' USING ERRCODE = '22023';
  END IF;

  IF v_operation NOT IN ('cancel', 'return') THEN
    RAISE EXCEPTION 'invalid_sale_return_operation' USING ERRCODE = '22023';
  END IF;

  IF v_reason NOT IN (
    'produto_com_defeito',
    'cliente_desistiu',
    'produto_incorreto',
    'erro_de_venda',
    'outro'
  ) THEN
    RAISE EXCEPTION 'invalid_sale_return_reason' USING ERRCODE = '22023';
  END IF;

  IF v_reason = 'outro' AND (v_notes IS NULL OR length(v_notes) < 3) THEN
    RAISE EXCEPTION 'sale_return_reason_required' USING ERRCODE = '22023';
  END IF;

  SELECT s.org_id
  INTO v_org_id
  FROM public.stores s
  WHERE s.id = v_store_id
    AND s.is_active IS TRUE;

  v_role := public.user_store_role(v_store_id);
  IF v_org_id IS NULL
    OR v_org_id IS DISTINCT FROM public.current_user_org_id()
    OR v_role IS NULL
  THEN
    RAISE EXCEPTION 'forbidden_sale_return' USING ERRCODE = '42501';
  END IF;

  IF v_operation = 'cancel'
    AND v_role IS DISTINCT FROM 'admin'
    AND v_role IS DISTINCT FROM 'manager'
  THEN
    RAISE EXCEPTION 'forbidden_sale_cancel' USING ERRCODE = '42501';
  END IF;

  IF v_operation = 'return'
    AND v_role IS DISTINCT FROM 'admin'
    AND v_role IS DISTINCT FROM 'manager'
    AND v_role IS DISTINCT FROM 'cashier'
  THEN
    RAISE EXCEPTION 'forbidden_sale_return' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.sale_returns sr
  WHERE sr.org_id = v_org_id
    AND sr.store_id = v_store_id
    AND sr.client_mutation_id = v_client_mutation_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.sale_id IS DISTINCT FROM v_sale_id
      OR v_existing.operation IS DISTINCT FROM v_operation
      OR v_existing.reason IS DISTINCT FROM v_reason
      OR v_existing.notes IS DISTINCT FROM v_notes
      OR v_existing.terminal_id IS DISTINCT FROM v_terminal_id
    THEN
      RAISE EXCEPTION 'idempotency_payload_mismatch' USING ERRCODE = '22023';
    END IF;

    -- Same mutation id must carry the same item set; otherwise conflict (no financial replay).
    IF (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'sale_item_id', sri.sale_item_id,
            'quantity', to_char(sri.quantity, 'FM9999999990.000')
          )
          ORDER BY sri.sale_item_id
        ),
        '[]'::jsonb
      )
      FROM public.sale_return_items sri
      WHERE sri.return_id = v_existing.id
    ) IS DISTINCT FROM (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'sale_item_id', (item.value->>'sale_item_id')::uuid,
            'quantity', to_char((item.value->>'quantity')::numeric(12, 3), 'FM9999999990.000')
          )
          ORDER BY (item.value->>'sale_item_id')::uuid
        ),
        '[]'::jsonb
      )
      FROM jsonb_array_elements(p_payload->'items') AS item(value)
    ) THEN
      RAISE EXCEPTION 'idempotency_payload_mismatch' USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'return_id', v_existing.id,
      'sale_id', v_existing.sale_id,
      'operation', v_existing.operation,
      'sale_status', (
        SELECT sa.status::text FROM public.sales sa WHERE sa.id = v_existing.sale_id
      ),
      'refund_total', to_char(v_existing.refund_total, 'FM9999999990.00'),
      'payment_refund_status', v_existing.payment_refund_status,
      'replay', true
    );
  END IF;

  SELECT *
  INTO v_sale
  FROM public.sales sa
  WHERE sa.id = v_sale_id
    AND sa.org_id = v_org_id
    AND sa.store_id = v_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_operation = 'cancel' THEN
    IF v_sale.status <> 'confirmed' THEN
      RAISE EXCEPTION 'sale_not_cancellable' USING ERRCODE = '22023';
    END IF;
  ELSIF v_sale.status NOT IN ('confirmed', 'partially_refunded') THEN
    RAISE EXCEPTION 'sale_not_returnable' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_payment
  FROM public.payments py
  WHERE py.sale_id = v_sale.id
    AND py.org_id = v_org_id
  ORDER BY py.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale_payment_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(sr.refund_total), 0)
  INTO v_already_refunded
  FROM public.sale_returns sr
  WHERE sr.sale_id = v_sale.id
    AND sr.org_id = v_org_id
    AND sr.store_id = v_store_id;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_payload->'items') AS item(value)
  LOOP
    BEGIN
      v_qty := (v_item->>'quantity')::numeric(12, 3);
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'invalid_sale_return_quantity' USING ERRCODE = '22023';
    END;

    IF v_qty IS NULL OR v_qty <= 0 OR scale(v_qty) > 3 THEN
      RAISE EXCEPTION 'invalid_sale_return_quantity' USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_sale_item
    FROM public.sale_items si
    WHERE si.id = NULLIF(v_item->>'sale_item_id', '')::uuid
      AND si.sale_id = v_sale.id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'sale_item_not_found' USING ERRCODE = 'P0002';
    END IF;

    IF v_sale_item.id = ANY (v_seen) THEN
      RAISE EXCEPTION 'duplicate_sale_return_item' USING ERRCODE = '22023';
    END IF;
    v_seen := array_append(v_seen, v_sale_item.id);

    SELECT COALESCE(SUM(sri.quantity), 0)
    INTO v_already_qty
    FROM public.sale_return_items sri
    WHERE sri.sale_item_id = v_sale_item.id;

    IF v_qty > (v_sale_item.quantity - v_already_qty) THEN
      RAISE EXCEPTION 'sale_return_quantity_exceeded' USING ERRCODE = '22023';
    END IF;

    v_line_total := round((v_sale_item.total * v_qty) / v_sale_item.quantity, 2);
    v_line_discount := round((v_sale_item.discount * v_qty) / v_sale_item.quantity, 2);
    v_items_subtotal := v_items_subtotal + v_line_total;

    v_items := v_items || jsonb_build_array(
      jsonb_build_object(
        'sale_item_id', v_sale_item.id,
        'product_id', v_sale_item.product_id,
        'quantity', v_qty,
        'unit_price', v_sale_item.unit_price,
        'line_discount', v_line_discount,
        'line_total', v_line_total
      )
    );
  END LOOP;

  IF v_operation = 'cancel' THEN
    -- Cancel must reverse every remaining returnable unit.
    IF EXISTS (
      SELECT 1
      FROM public.sale_items si
      LEFT JOIN (
        SELECT sri.sale_item_id, SUM(sri.quantity) AS returned_qty
        FROM public.sale_return_items sri
        WHERE sri.sale_id = v_sale.id
        GROUP BY sri.sale_item_id
      ) r ON r.sale_item_id = si.id
      WHERE si.sale_id = v_sale.id
        AND (si.quantity - COALESCE(r.returned_qty, 0)) > 0
        AND NOT (si.id = ANY (v_seen))
    ) THEN
      RAISE EXCEPTION 'sale_cancel_requires_all_items' USING ERRCODE = '22023';
    END IF;

    FOR v_sale_item IN
      SELECT si.*
      FROM public.sale_items si
      WHERE si.sale_id = v_sale.id
    LOOP
      SELECT COALESCE(SUM(sri.quantity), 0)
      INTO v_already_qty
      FROM public.sale_return_items sri
      WHERE sri.sale_item_id = v_sale_item.id;

      SELECT (value->>'quantity')::numeric(12, 3)
      INTO v_qty
      FROM jsonb_array_elements(v_items) AS item(value)
      WHERE (value->>'sale_item_id')::uuid = v_sale_item.id;

      IF COALESCE(v_qty, 0) IS DISTINCT FROM (v_sale_item.quantity - v_already_qty) THEN
        RAISE EXCEPTION 'sale_cancel_requires_all_items' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  IF v_sale.subtotal > 0 AND v_sale.discount > 0 THEN
    v_header_share := round((v_sale.discount * v_items_subtotal) / v_sale.subtotal, 2);
  ELSE
    v_header_share := 0;
  END IF;

  v_refund_total := round(v_items_subtotal - v_header_share, 2);
  IF v_refund_total < 0 THEN
    RAISE EXCEPTION 'invalid_sale_return_total' USING ERRCODE = '22023';
  END IF;

  v_remaining_refundable := round(v_sale.total - v_already_refunded, 2);
  IF v_refund_total > v_remaining_refundable THEN
    IF abs(v_refund_total - v_remaining_refundable) <= 0.02 THEN
      v_refund_total := v_remaining_refundable;
    ELSE
      RAISE EXCEPTION 'sale_return_amount_exceeded' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_payment.method = 'cash' THEN
    IF v_cash_session_id IS NULL THEN
      RAISE EXCEPTION 'cash_session_required' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.cash_sessions cs
      WHERE cs.id = v_cash_session_id
        AND cs.org_id = v_org_id
        AND cs.store_id = v_store_id
        AND cs.terminal_id = v_terminal_id
        AND cs.status = 'open'
    ) THEN
      RAISE EXCEPTION 'cash_session_closed' USING ERRCODE = '22023';
    END IF;
    v_payment_refund_status := 'completed';
  ELSIF v_payment.method IN ('card', 'pix', 'voucher', 'other') THEN
    v_payment_refund_status := 'pending_external';
  ELSE
    v_payment_refund_status := 'not_applicable';
  END IF;

  INSERT INTO public.sale_returns (
    org_id,
    store_id,
    sale_id,
    terminal_id,
    operator_id,
    operation,
    reason,
    notes,
    client_mutation_id,
    items_subtotal,
    header_discount_share,
    refund_total,
    payment_method,
    cash_session_id,
    payment_refund_status
  )
  VALUES (
    v_org_id,
    v_store_id,
    v_sale.id,
    v_terminal_id,
    v_user_id,
    v_operation,
    v_reason,
    v_notes,
    v_client_mutation_id,
    v_items_subtotal,
    v_header_share,
    v_refund_total,
    v_payment.method,
    v_cash_session_id,
    v_payment_refund_status
  )
  RETURNING * INTO v_return;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) AS item(value)
  LOOP
    v_qty := (v_item->>'quantity')::numeric(12, 3);

    INSERT INTO public.sale_return_items (
      return_id,
      org_id,
      store_id,
      sale_id,
      sale_item_id,
      product_id,
      quantity,
      unit_price,
      line_discount,
      line_total
    )
    VALUES (
      v_return.id,
      v_org_id,
      v_store_id,
      v_sale.id,
      (v_item->>'sale_item_id')::uuid,
      (v_item->>'product_id')::uuid,
      v_qty,
      (v_item->>'unit_price')::numeric(12, 2),
      (v_item->>'line_discount')::numeric(12, 2),
      (v_item->>'line_total')::numeric(12, 2)
    );

    SELECT ib.quantity
    INTO v_balance
    FROM public.inventory_balances ib
    WHERE ib.org_id = v_org_id
      AND ib.store_id = v_store_id
      AND ib.product_id = (v_item->>'product_id')::uuid
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.inventory_balances (org_id, store_id, product_id, quantity)
      VALUES (v_org_id, v_store_id, (v_item->>'product_id')::uuid, 0)
      ON CONFLICT (store_id, product_id) DO NOTHING;

      SELECT ib.quantity
      INTO v_balance
      FROM public.inventory_balances ib
      WHERE ib.org_id = v_org_id
        AND ib.store_id = v_store_id
        AND ib.product_id = (v_item->>'product_id')::uuid
      FOR UPDATE;
    END IF;

    v_next_balance := v_balance + v_qty;
    UPDATE public.inventory_balances
    SET quantity = v_next_balance,
        updated_at = now()
    WHERE org_id = v_org_id
      AND store_id = v_store_id
      AND product_id = (v_item->>'product_id')::uuid;

    INSERT INTO public.inventory_movements (
      org_id,
      store_id,
      product_id,
      sale_id,
      movement_type,
      quantity_change,
      balance_after,
      created_by,
      reason,
      actor_role,
      client_mutation_id,
      terminal_id
    )
    VALUES (
      v_org_id,
      v_store_id,
      (v_item->>'product_id')::uuid,
      v_sale.id,
      'refund',
      v_qty,
      v_next_balance,
      v_user_id,
      left(format('sale_%s:%s', v_operation, v_reason), 200),
      v_role,
      NULL,
      v_terminal_id
    );
  END LOOP;

  SELECT COALESCE(SUM(si.quantity - COALESCE(r.returned_qty, 0)), 0)
  INTO v_remaining_qty
  FROM public.sale_items si
  LEFT JOIN (
    SELECT sri.sale_item_id, SUM(sri.quantity) AS returned_qty
    FROM public.sale_return_items sri
    WHERE sri.sale_id = v_sale.id
    GROUP BY sri.sale_item_id
  ) r ON r.sale_item_id = si.id
  WHERE si.sale_id = v_sale.id;

  IF v_operation = 'cancel' THEN
    v_next_status := 'cancelled';
  ELSIF v_remaining_qty <= 0 THEN
    v_next_status := 'refunded';
  ELSE
    v_next_status := 'partially_refunded';
  END IF;

  UPDATE public.sales
  SET status = v_next_status,
      updated_at = now()
  WHERE id = v_sale.id
    AND org_id = v_org_id
    AND store_id = v_store_id;

  IF v_payment.method = 'cash' AND v_payment_refund_status = 'completed' THEN
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
      payment_id,
      sale_return_id
    )
    VALUES (
      v_cash_session_id,
      v_org_id,
      v_store_id,
      v_terminal_id,
      'refund_cash',
      -v_refund_total,
      left(format('Devolução venda %s (%s)', v_sale.id, v_reason), 500),
      v_user_id,
      v_client_mutation_id,
      v_sale.id,
      v_payment.id,
      v_return.id
    );

    IF v_next_status IN ('cancelled', 'refunded') THEN
      UPDATE public.payments
      SET status = 'refunded'
      WHERE id = v_payment.id
        AND org_id = v_org_id
        AND store_id = v_store_id
        AND status = 'captured';
    END IF;
  END IF;

  -- Fiscal: request cancel intent via existing outbox helper when document exists.
  IF v_next_status IN ('cancelled', 'refunded') THEN
    BEGIN
      PERFORM public.request_fiscal_cancel(
        jsonb_build_object(
          'store_id', v_store_id,
          'sale_id', v_sale.id,
          'operation_id', v_client_mutation_id
        )
      );
    EXCEPTION
      WHEN OTHERS THEN
        -- Fiscal remains best-effort; commercial return already committed.
        NULL;
    END;
  END IF;

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
    'sale_return',
    v_return.id,
    CASE WHEN v_operation = 'cancel' THEN 'sale.cancelled' ELSE 'sale.returned' END,
    jsonb_build_object(
      'sale_id', v_sale.id,
      'client_mutation_id', v_client_mutation_id,
      'operation', v_operation,
      'reason', v_reason,
      'refund_total', v_refund_total,
      'payment_method', v_payment.method,
      'payment_refund_status', v_payment_refund_status,
      'sale_status', v_next_status,
      'items', v_items
    )
  );

  RETURN jsonb_build_object(
    'return_id', v_return.id,
    'sale_id', v_sale.id,
    'operation', v_operation,
    'sale_status', v_next_status::text,
    'refund_total', to_char(v_refund_total, 'FM9999999990.00'),
    'payment_refund_status', v_payment_refund_status,
    'payment_method', v_payment.method::text,
    'replay', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_sale(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_store_id uuid;
  v_sale_id uuid;
  v_org_id uuid;
  v_items jsonb := '[]'::jsonb;
  v_payload jsonb;
BEGIN
  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_sale_id := NULLIF(p_payload->>'sale_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_sale_return_payload' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'forbidden_sale_return' USING ERRCODE = '42501';
  END IF;

  IF public.user_store_role(v_store_id) IS DISTINCT FROM 'admin'
    AND public.user_store_role(v_store_id) IS DISTINCT FROM 'manager'
  THEN
    RAISE EXCEPTION 'forbidden_sale_cancel' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'sale_item_id', si.id,
      'quantity', to_char(si.quantity - COALESCE(r.returned_qty, 0), 'FM9999999990.000')
    )
  ), '[]'::jsonb)
  INTO v_items
  FROM public.sale_items si
  LEFT JOIN (
    SELECT sri.sale_item_id, SUM(sri.quantity) AS returned_qty
    FROM public.sale_return_items sri
    WHERE sri.sale_id = v_sale_id
    GROUP BY sri.sale_item_id
  ) r ON r.sale_item_id = si.id
  WHERE si.sale_id = v_sale_id
    AND (si.quantity - COALESCE(r.returned_qty, 0)) > 0;

  IF jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'sale_not_cancellable' USING ERRCODE = '22023';
  END IF;

  v_payload := p_payload
    || jsonb_build_object(
      'operation', 'cancel',
      'items', v_items
    );

  RETURN public.process_sale_return(v_payload);
END;
$$;


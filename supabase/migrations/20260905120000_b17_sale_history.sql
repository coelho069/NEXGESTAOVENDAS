-- B17 — commercial sale history consultation (server-authoritative, store-scoped).

CREATE OR REPLACE FUNCTION public.list_sales(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_after_id uuid;
  v_after_created_at timestamptz;
  v_limit integer;
  v_query text;
  v_status text;
  v_org_id uuid;
  v_rows jsonb;
  v_trimmed jsonb;
  v_next_cursor jsonb := NULL;
  v_has_more boolean := false;
BEGIN
  IF v_user_id IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_sale_query' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_after_id := NULLIF(p_payload->>'after_id', '')::uuid;
    v_after_created_at := NULLIF(p_payload->>'after_created_at', '')::timestamptz;
    v_limit := LEAST(GREATEST(COALESCE((p_payload->>'limit')::integer, 20), 1), 100);
    v_query := NULLIF(btrim(COALESCE(p_payload->>'query', '')), '');
    v_status := NULLIF(btrim(COALESCE(p_payload->>'status', '')), '');
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_sale_query' USING ERRCODE = '22023';
  END;

  IF v_status IS NOT NULL
    AND v_status NOT IN (
      'draft',
      'pending_sync',
      'confirmed',
      'cancelled',
      'refunded',
      'partially_refunded'
    )
  THEN
    RAISE EXCEPTION 'invalid_sale_query' USING ERRCODE = '22023';
  END IF;

  SELECT s.org_id
  INTO v_org_id
  FROM public.stores s
  WHERE s.id = v_store_id
    AND s.is_active IS TRUE;

  IF v_org_id IS NULL
    OR v_org_id IS DISTINCT FROM public.current_user_org_id()
    OR public.user_store_role(v_store_id) IS NULL
  THEN
    RAISE EXCEPTION 'forbidden_sale_history' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(row_to_json(rows) ORDER BY rows.created_at DESC, rows.sale_id DESC),
    '[]'::jsonb
  )
  INTO v_rows
  FROM (
    SELECT
      sa.id AS sale_id,
      sa.status::text AS status,
      sa.sync_status::text AS sync_status,
      sa.subtotal::text AS subtotal,
      sa.discount::text AS discount,
      sa.total::text AS total,
      c.name AS customer_name,
      sa.cashier_id,
      p.full_name AS operator_name,
      pay.method::text AS payment_method,
      pay.status::text AS payment_status,
      sa.created_at,
      sa.confirmed_at
    FROM public.sales sa
    LEFT JOIN public.customers c
      ON c.id = sa.customer_id
     AND c.org_id = sa.org_id
    LEFT JOIN public.profiles p
      ON p.id = sa.cashier_id
    LEFT JOIN LATERAL (
      SELECT py.method, py.status
      FROM public.payments py
      WHERE py.sale_id = sa.id
        AND py.org_id = sa.org_id
      ORDER BY py.created_at ASC
      LIMIT 1
    ) pay ON TRUE
    WHERE sa.org_id = v_org_id
      AND sa.store_id = v_store_id
      AND (v_status IS NULL OR sa.status::text = v_status)
      AND (
        v_query IS NULL
        OR sa.id::text ILIKE '%' || v_query || '%'
        OR COALESCE(c.name, '') ILIKE '%' || v_query || '%'
        OR COALESCE(p.full_name, '') ILIKE '%' || v_query || '%'
        OR COALESCE(pay.method::text, '') ILIKE '%' || v_query || '%'
      )
      AND (
        v_after_created_at IS NULL
        OR v_after_id IS NULL
        OR (sa.created_at, sa.id) < (v_after_created_at, v_after_id)
      )
    ORDER BY sa.created_at DESC, sa.id DESC
    LIMIT v_limit + 1
  ) rows;

  v_has_more := jsonb_array_length(v_rows) > v_limit;
  IF v_has_more THEN
    v_trimmed := (
      SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
      FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS elem(value, ordinality)
      WHERE ordinality <= v_limit
    );
    v_next_cursor := jsonb_build_object(
      'after_created_at', v_trimmed->(v_limit - 1)->>'created_at',
      'after_id', v_trimmed->(v_limit - 1)->>'sale_id'
    );
  ELSE
    v_trimmed := v_rows;
  END IF;

  RETURN jsonb_build_object(
    'rows', v_trimmed,
    'next_cursor', v_next_cursor,
    'has_more', v_has_more
  );
END
$$;

CREATE OR REPLACE FUNCTION public.get_sale_detail(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_sale_id uuid;
  v_org_id uuid;
  v_sale public.sales%ROWTYPE;
  v_customer_name text;
  v_operator_name text;
  v_items jsonb;
  v_payments jsonb;
  v_payment_method text;
  v_payment_status text;
BEGIN
  IF v_user_id IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_sale_query' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_sale_id := NULLIF(p_payload->>'sale_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_sale_query' USING ERRCODE = '22023';
  END;

  IF v_store_id IS NULL OR v_sale_id IS NULL THEN
    RAISE EXCEPTION 'invalid_sale_query' USING ERRCODE = '22023';
  END IF;

  SELECT s.org_id
  INTO v_org_id
  FROM public.stores s
  WHERE s.id = v_store_id
    AND s.is_active IS TRUE;

  IF v_org_id IS NULL
    OR v_org_id IS DISTINCT FROM public.current_user_org_id()
    OR public.user_store_role(v_store_id) IS NULL
  THEN
    RAISE EXCEPTION 'forbidden_sale_history' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_sale
  FROM public.sales sa
  WHERE sa.id = v_sale_id
    AND sa.org_id = v_org_id
    AND sa.store_id = v_store_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT c.name
  INTO v_customer_name
  FROM public.customers c
  WHERE c.id = v_sale.customer_id
    AND c.org_id = v_org_id;

  SELECT p.full_name
  INTO v_operator_name
  FROM public.profiles p
  WHERE p.id = v_sale.cashier_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'product_id', si.product_id,
      'product_sku', si.product_sku,
      'product_name', si.product_name,
      'quantity', to_char(si.quantity, 'FM9999999990.000'),
      'unit_price', to_char(si.unit_price, 'FM9999999990.00'),
      'discount', to_char(si.discount, 'FM9999999990.00'),
      'total', to_char(si.total, 'FM9999999990.00')
    )
    ORDER BY si.created_at ASC, si.id ASC
  ), '[]'::jsonb)
  INTO v_items
  FROM public.sale_items si
  WHERE si.sale_id = v_sale.id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'payment_id', py.id,
      'method', py.method::text,
      'status', py.status::text,
      'amount', to_char(py.amount, 'FM9999999990.00')
    )
    ORDER BY py.created_at ASC, py.id ASC
  ), '[]'::jsonb)
  INTO v_payments
  FROM public.payments py
  WHERE py.sale_id = v_sale.id
    AND py.org_id = v_org_id;

  SELECT py.method::text, py.status::text
  INTO v_payment_method, v_payment_status
  FROM public.payments py
  WHERE py.sale_id = v_sale.id
    AND py.org_id = v_org_id
  ORDER BY py.created_at ASC
  LIMIT 1;

  RETURN jsonb_build_object(
    'sale_id', v_sale.id,
    'status', v_sale.status::text,
    'sync_status', v_sale.sync_status::text,
    'subtotal', to_char(v_sale.subtotal, 'FM9999999990.00'),
    'discount', to_char(v_sale.discount, 'FM9999999990.00'),
    'total', to_char(v_sale.total, 'FM9999999990.00'),
    'customer_name', v_customer_name,
    'cashier_id', v_sale.cashier_id,
    'operator_name', v_operator_name,
    'payment_method', v_payment_method,
    'payment_status', v_payment_status,
    'created_at', v_sale.created_at,
    'confirmed_at', v_sale.confirmed_at,
    'notes', v_sale.notes,
    'items', v_items,
    'payments', v_payments
  );
END
$$;

REVOKE ALL ON FUNCTION public.list_sales(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_sale_detail(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_sales(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sale_detail(jsonb) TO authenticated;

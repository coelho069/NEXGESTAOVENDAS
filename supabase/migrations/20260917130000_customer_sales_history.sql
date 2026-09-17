-- Customer sales history: lifetime revenue + paginated sale list (org-scoped, store-access filtered).

CREATE INDEX IF NOT EXISTS sales_customer_created_idx
  ON public.sales (customer_id, created_at DESC, id DESC)
  WHERE customer_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.list_customer_sales(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_org_id uuid := public.current_user_org_id();
  v_customer_id uuid;
  v_after_id uuid;
  v_after_created_at timestamptz;
  v_limit integer;
  v_rows jsonb;
  v_trimmed jsonb;
  v_next_cursor jsonb := NULL;
  v_has_more boolean := false;
  v_lifetime_revenue numeric(12, 2) := 0;
  v_sales_count bigint := 0;
  v_last_sale_at timestamptz := NULL;
BEGIN
  IF v_user_id IS NULL
    OR v_org_id IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_customer_sales_query' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_customer_id := NULLIF(p_payload->>'customer_id', '')::uuid;
    v_after_id := NULLIF(p_payload->>'after_id', '')::uuid;
    v_after_created_at := NULLIF(p_payload->>'after_created_at', '')::timestamptz;
    v_limit := LEAST(GREATEST(COALESCE((p_payload->>'limit')::integer, 20), 1), 100);
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_customer_sales_query' USING ERRCODE = '22023';
  END;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'invalid_customer_sales_query' USING ERRCODE = '22023';
  END IF;

  IF (v_after_id IS NULL) <> (v_after_created_at IS NULL) THEN
    RAISE EXCEPTION 'invalid_customer_sales_query' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.customers c
    WHERE c.id = v_customer_id
      AND c.org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Payment Guardian: lifetime revenue counts only confirmed sales with captured payment.
  WITH eligible_sales AS (
    SELECT
      s.id,
      s.total,
      s.created_at
    FROM public.sales s
    JOIN public.payments p
      ON p.sale_id = s.id
     AND p.org_id = s.org_id
     AND p.store_id = s.store_id
    WHERE s.customer_id = v_customer_id
      AND s.org_id = v_org_id
      AND public.user_has_store_access(s.store_id)
      AND s.status = 'confirmed'
      AND p.status = 'captured'
      AND p.amount = s.total
  )
  SELECT
    COALESCE(SUM(es.total), 0),
    COUNT(*),
    MAX(es.created_at)
  INTO v_lifetime_revenue, v_sales_count, v_last_sale_at
  FROM eligible_sales es;

  SELECT COALESCE(jsonb_agg(row_to_json(rows) ORDER BY rows.created_at DESC, rows.sale_id DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      s.id AS sale_id,
      s.store_id,
      st.name AS store_name,
      s.status::text AS status,
      s.sync_status::text AS sync_status,
      s.total::text AS total,
      s.discount::text AS discount,
      s.subtotal::text AS subtotal,
      c.name AS customer_name,
      s.cashier_id,
      op.full_name AS operator_name,
      py.method::text AS payment_method,
      py.status::text AS payment_status,
      s.created_at,
      s.confirmed_at
    FROM public.sales s
    JOIN public.stores st
      ON st.id = s.store_id
     AND st.org_id = s.org_id
    LEFT JOIN public.customers c
      ON c.id = s.customer_id
     AND c.org_id = s.org_id
    LEFT JOIN public.profiles op
      ON op.id = s.cashier_id
    LEFT JOIN LATERAL (
      SELECT p.method, p.status
      FROM public.payments p
      WHERE p.sale_id = s.id
        AND p.org_id = s.org_id
        AND p.store_id = s.store_id
      ORDER BY p.created_at ASC, p.id ASC
      LIMIT 1
    ) py ON TRUE
    WHERE s.customer_id = v_customer_id
      AND s.org_id = v_org_id
      AND public.user_has_store_access(s.store_id)
      AND (
        v_after_id IS NULL
        OR v_after_created_at IS NULL
        OR (s.created_at, s.id) < (v_after_created_at, v_after_id)
      )
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT v_limit + 1
  ) rows;

  v_has_more := jsonb_array_length(v_rows) > v_limit;
  IF v_has_more THEN
    v_next_cursor := jsonb_build_object(
      'after_created_at', v_rows->(v_limit - 1)->>'created_at',
      'after_id', v_rows->(v_limit - 1)->>'sale_id'
    );
    SELECT COALESCE(jsonb_agg(value ORDER BY ordinality), '[]'::jsonb)
    INTO v_trimmed
    FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS page(value, ordinality)
    WHERE ordinality <= v_limit;
  ELSE
    v_trimmed := v_rows;
  END IF;

  RETURN jsonb_build_object(
    'summary', jsonb_build_object(
      'lifetime_revenue', to_char(v_lifetime_revenue, 'FM9999999990.00'),
      'sales_count', v_sales_count,
      'last_sale_at', v_last_sale_at
    ),
    'rows', v_trimmed,
    'has_more', v_has_more,
    'next_cursor', v_next_cursor
  );
END
$$;

REVOKE ALL ON FUNCTION public.list_customer_sales(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_customer_sales(jsonb) TO authenticated;

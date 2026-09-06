-- B19 hardening: make customer search literal, support formatted documents,
-- and keep both cursor RPCs deterministic when called outside the API routes.

CREATE INDEX IF NOT EXISTS customers_org_document_digits_idx
  ON public.customers (
    org_id,
    regexp_replace(COALESCE(document, ''), '\D', '', 'g')
  )
  WHERE document IS NOT NULL
    AND regexp_replace(COALESCE(document, ''), '\D', '', 'g') <> '';

CREATE OR REPLACE FUNCTION public.search_customers(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_org_id uuid;
  v_query text;
  v_digits text;
  v_limit integer;
  v_after_name text;
  v_after_id uuid;
  v_rows jsonb;
  v_trimmed jsonb;
  v_has_more boolean := false;
  v_next_cursor jsonb := NULL;
BEGIN
  IF v_user_id IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_customer_query' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_query := NULLIF(lower(btrim(COALESCE(p_payload->>'query', ''))), '');
    v_digits := NULLIF(regexp_replace(COALESCE(v_query, ''), '\D', '', 'g'), '');
    v_limit := LEAST(GREATEST(COALESCE((p_payload->>'limit')::integer, 20), 1), 100);
    v_after_name := NULLIF(btrim(COALESCE(p_payload->>'after_name', '')), '');
    v_after_id := NULLIF(p_payload->>'after_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_customer_query' USING ERRCODE = '22023';
  END;

  IF v_store_id IS NULL
    OR (v_after_name IS NULL) <> (v_after_id IS NULL)
  THEN
    RAISE EXCEPTION 'invalid_customer_query' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'forbidden_customers' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', rows.id,
        'name', rows.name,
        'document', rows.document,
        'email', rows.email,
        'phone', rows.phone,
        'created_at', rows.created_at,
        'updated_at', rows.updated_at
      )
      ORDER BY lower(btrim(rows.name)) ASC, rows.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM (
    SELECT c.id, c.name, c.document, c.email, c.phone, c.created_at, c.updated_at
    FROM public.customers c
    WHERE c.org_id = v_org_id
      AND (
        v_query IS NULL
        OR position(v_query IN lower(btrim(c.name))) > 0
        OR position(v_query IN lower(COALESCE(c.document, ''))) > 0
        OR position(v_query IN lower(COALESCE(c.email, ''))) > 0
        OR (
          v_digits IS NOT NULL
          AND (
            position(v_digits IN regexp_replace(COALESCE(c.document, ''), '\D', '', 'g')) > 0
            OR position(v_digits IN regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g')) > 0
          )
        )
      )
      AND (
        v_after_name IS NULL
        OR (lower(btrim(c.name)), c.id) > (lower(btrim(v_after_name)), v_after_id)
      )
    ORDER BY lower(btrim(c.name)) ASC, c.id ASC
    LIMIT v_limit + 1
  ) rows;

  IF jsonb_array_length(v_rows) > v_limit THEN
    v_has_more := true;
    v_trimmed := (
      SELECT COALESCE(jsonb_agg(value ORDER BY ord), '[]'::jsonb)
      FROM (
        SELECT value, ord
        FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(value, ord)
        WHERE ord <= v_limit
      ) s
    );
    v_next_cursor := jsonb_build_object(
      'after_name', v_trimmed -> (jsonb_array_length(v_trimmed) - 1) ->> 'name',
      'after_id', v_trimmed -> (jsonb_array_length(v_trimmed) - 1) ->> 'id'
    );
  ELSE
    v_trimmed := v_rows;
  END IF;

  RETURN jsonb_build_object(
    'rows', v_trimmed,
    'has_more', v_has_more,
    'next_cursor', v_next_cursor
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_detail(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_customer_id uuid;
  v_org_id uuid;
  v_customer public.customers%ROWTYPE;
  v_limit integer;
  v_after_created_at timestamptz;
  v_after_id uuid;
  v_sales jsonb;
  v_trimmed jsonb;
  v_has_more boolean := false;
  v_next_cursor jsonb := NULL;
BEGIN
  IF v_user_id IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_customer_query' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_customer_id := NULLIF(p_payload->>'customer_id', '')::uuid;
    v_limit := LEAST(GREATEST(COALESCE((p_payload->>'limit')::integer, 20), 1), 100);
    v_after_created_at := NULLIF(p_payload->>'after_created_at', '')::timestamptz;
    v_after_id := NULLIF(p_payload->>'after_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_customer_query' USING ERRCODE = '22023';
  END;

  IF v_store_id IS NULL
    OR v_customer_id IS NULL
    OR (v_after_created_at IS NULL) <> (v_after_id IS NULL)
  THEN
    RAISE EXCEPTION 'invalid_customer_query' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'forbidden_customers' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_customer
  FROM public.customers c
  WHERE c.id = v_customer_id
    AND c.org_id = v_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'sale_id', rows.sale_id,
        'store_id', rows.store_id,
        'status', rows.status,
        'total', rows.total,
        'created_at', rows.created_at,
        'confirmed_at', rows.confirmed_at,
        'payment_method', rows.payment_method
      )
      ORDER BY rows.created_at DESC, rows.sale_id DESC
    ),
    '[]'::jsonb
  )
  INTO v_sales
  FROM (
    SELECT
      sa.id AS sale_id,
      sa.store_id,
      sa.status::text AS status,
      to_char(sa.total, 'FM9999999990.00') AS total,
      sa.created_at,
      sa.confirmed_at,
      pay.method::text AS payment_method
    FROM public.sales sa
    LEFT JOIN LATERAL (
      SELECT py.method
      FROM public.payments py
      WHERE py.sale_id = sa.id
        AND py.org_id = sa.org_id
      ORDER BY py.created_at ASC
      LIMIT 1
    ) pay ON TRUE
    WHERE sa.org_id = v_org_id
      AND sa.customer_id = v_customer.id
      AND public.user_has_store_access(sa.store_id) IS TRUE
      AND (
        v_after_created_at IS NULL
        OR (sa.created_at, sa.id) < (v_after_created_at, v_after_id)
      )
    ORDER BY sa.created_at DESC, sa.id DESC
    LIMIT v_limit + 1
  ) rows;

  IF jsonb_array_length(v_sales) > v_limit THEN
    v_has_more := true;
    v_trimmed := (
      SELECT COALESCE(jsonb_agg(value ORDER BY ord), '[]'::jsonb)
      FROM (
        SELECT value, ord
        FROM jsonb_array_elements(v_sales) WITH ORDINALITY AS t(value, ord)
        WHERE ord <= v_limit
      ) s
    );
    v_next_cursor := jsonb_build_object(
      'after_created_at', v_trimmed -> (jsonb_array_length(v_trimmed) - 1) ->> 'created_at',
      'after_id', v_trimmed -> (jsonb_array_length(v_trimmed) - 1) ->> 'sale_id'
    );
  ELSE
    v_trimmed := v_sales;
  END IF;

  RETURN jsonb_build_object(
    'customer', jsonb_build_object(
      'id', v_customer.id,
      'name', v_customer.name,
      'document', v_customer.document,
      'email', v_customer.email,
      'phone', v_customer.phone,
      'created_at', v_customer.created_at,
      'updated_at', v_customer.updated_at
    ),
    'sales', v_trimmed,
    'has_more', v_has_more,
    'next_cursor', v_next_cursor
  );
END;
$$;

REVOKE ALL ON FUNCTION public.search_customers(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_customer_detail(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_customers(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_detail(jsonb) TO authenticated;

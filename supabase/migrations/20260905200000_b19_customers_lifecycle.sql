-- B19 — customer lifecycle (search / upsert / detail + sale history).
-- Reuses public.customers (org-scoped). Writes remain SECURITY DEFINER RPCs.

CREATE INDEX IF NOT EXISTS customers_org_name_idx
  ON public.customers (org_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS customers_org_document_idx
  ON public.customers (org_id, lower(btrim(document)))
  WHERE document IS NOT NULL AND btrim(document) <> '';

CREATE INDEX IF NOT EXISTS customers_org_phone_idx
  ON public.customers (org_id, regexp_replace(COALESCE(phone, ''), '\D', '', 'g'))
  WHERE phone IS NOT NULL AND btrim(phone) <> '';

CREATE INDEX IF NOT EXISTS customers_org_email_idx
  ON public.customers (org_id, lower(btrim(email)))
  WHERE email IS NOT NULL AND btrim(email) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS customers_org_document_unique
  ON public.customers (org_id, lower(btrim(document)))
  WHERE document IS NOT NULL AND btrim(document) <> '';

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
  v_limit integer;
  v_after_name text;
  v_after_id uuid;
  v_rows jsonb;
  v_trimmed jsonb;
  v_has_more boolean := false;
  v_next_cursor jsonb := NULL;
  v_needle text;
BEGIN
  IF v_user_id IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_customer_query' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_query := NULLIF(btrim(COALESCE(p_payload->>'query', '')), '');
    v_limit := LEAST(GREATEST(COALESCE((p_payload->>'limit')::integer, 20), 1), 100);
    v_after_name := NULLIF(btrim(COALESCE(p_payload->>'after_name', '')), '');
    v_after_id := NULLIF(p_payload->>'after_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_customer_query' USING ERRCODE = '22023';
  END;

  IF v_store_id IS NULL THEN
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

  v_needle := CASE
    WHEN v_query IS NULL THEN NULL
    ELSE lower(v_query)
  END;

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
      ORDER BY lower(rows.name) ASC, rows.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM (
    SELECT c.id, c.name, c.document, c.email, c.phone, c.created_at, c.updated_at
    FROM public.customers c
    WHERE c.org_id = v_org_id
      AND (
        v_needle IS NULL
        OR lower(c.name) LIKE '%' || v_needle || '%'
        OR lower(COALESCE(c.document, '')) LIKE '%' || v_needle || '%'
        OR lower(COALESCE(c.email, '')) LIKE '%' || v_needle || '%'
        OR regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g')
             LIKE '%' || regexp_replace(v_needle, '\D', '', 'g') || '%'
      )
      AND (
        v_after_name IS NULL
        OR v_after_id IS NULL
        OR (lower(c.name), c.id) > (lower(v_after_name), v_after_id)
      )
    ORDER BY lower(c.name) ASC, c.id ASC
    LIMIT v_limit + 1
  ) rows;

  IF jsonb_array_length(v_rows) > v_limit THEN
    v_has_more := true;
    v_trimmed := (
      SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
      FROM (
        SELECT value
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

CREATE OR REPLACE FUNCTION public.upsert_customer(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_org_id uuid;
  v_customer_id uuid;
  v_name text;
  v_document text;
  v_email text;
  v_phone text;
  v_existing public.customers%ROWTYPE;
  v_conflict_id uuid;
BEGIN
  IF v_user_id IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_customer_payload' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_customer_id := NULLIF(p_payload->>'customer_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_customer_payload' USING ERRCODE = '22023';
  END;

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'invalid_customer_payload' USING ERRCODE = '22023';
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

  -- Never trust client-supplied org_id.
  IF p_payload ? 'org_id' OR p_payload ? 'organization_id' THEN
    RAISE EXCEPTION 'invalid_customer_payload' USING ERRCODE = '22023';
  END IF;

  v_name := NULLIF(btrim(COALESCE(p_payload->>'name', '')), '');
  v_document := NULLIF(btrim(COALESCE(p_payload->>'document', '')), '');
  v_email := NULLIF(lower(btrim(COALESCE(p_payload->>'email', ''))), '');
  v_phone := NULLIF(btrim(COALESCE(p_payload->>'phone', '')), '');

  IF v_name IS NULL OR length(v_name) < 2 OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'invalid_customer_name' USING ERRCODE = '22023';
  END IF;

  IF v_document IS NOT NULL THEN
    v_document := regexp_replace(v_document, '\D', '', 'g');
    IF v_document !~ '^\d{11}$' AND v_document !~ '^\d{14}$' THEN
      RAISE EXCEPTION 'invalid_customer_document' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_email IS NOT NULL THEN
    IF length(v_email) > 254
      OR v_email !~ '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$'
    THEN
      RAISE EXCEPTION 'invalid_customer_email' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_phone IS NOT NULL THEN
    v_phone := regexp_replace(v_phone, '[^\d+]', '', 'g');
    IF length(regexp_replace(v_phone, '\D', '', 'g')) < 10
      OR length(regexp_replace(v_phone, '\D', '', 'g')) > 13
    THEN
      RAISE EXCEPTION 'invalid_customer_phone' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_customer_id IS NOT NULL THEN
    SELECT *
    INTO v_existing
    FROM public.customers c
    WHERE c.id = v_customer_id
      AND c.org_id = v_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0002';
    END IF;

    IF v_document IS NOT NULL THEN
      SELECT c.id
      INTO v_conflict_id
      FROM public.customers c
      WHERE c.org_id = v_org_id
        AND c.id <> v_customer_id
        AND lower(btrim(COALESCE(c.document, ''))) = lower(v_document)
      LIMIT 1;

      IF v_conflict_id IS NOT NULL THEN
        RAISE EXCEPTION 'customer_document_conflict' USING ERRCODE = '23505';
      END IF;
    END IF;

    UPDATE public.customers
    SET name = v_name,
        document = v_document,
        email = v_email,
        phone = v_phone,
        updated_at = now()
    WHERE id = v_customer_id
      AND org_id = v_org_id
    RETURNING * INTO v_existing;
  ELSE
    IF v_document IS NOT NULL THEN
      SELECT c.id
      INTO v_conflict_id
      FROM public.customers c
      WHERE c.org_id = v_org_id
        AND lower(btrim(COALESCE(c.document, ''))) = lower(v_document)
      LIMIT 1;

      IF v_conflict_id IS NOT NULL THEN
        RAISE EXCEPTION 'customer_document_conflict' USING ERRCODE = '23505';
      END IF;
    END IF;

    INSERT INTO public.customers (org_id, name, document, email, phone)
    VALUES (v_org_id, v_name, v_document, v_email, v_phone)
    RETURNING * INTO v_existing;
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
    'customer',
    v_existing.id,
    CASE WHEN v_customer_id IS NULL THEN 'customer.created' ELSE 'customer.updated' END,
    jsonb_build_object(
      'name', v_existing.name,
      'document', v_existing.document,
      'email', v_existing.email,
      'phone', v_existing.phone
    )
  );

  RETURN jsonb_build_object(
    'id', v_existing.id,
    'name', v_existing.name,
    'document', v_existing.document,
    'email', v_existing.email,
    'phone', v_existing.phone,
    'created_at', v_existing.created_at,
    'updated_at', v_existing.updated_at
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

  IF v_store_id IS NULL OR v_customer_id IS NULL THEN
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

  -- Sale history is limited to stores the operator can access (never cross-org).
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
        OR v_after_id IS NULL
        OR (sa.created_at, sa.id) < (v_after_created_at, v_after_id)
      )
    ORDER BY sa.created_at DESC, sa.id DESC
    LIMIT v_limit + 1
  ) rows;

  IF jsonb_array_length(v_sales) > v_limit THEN
    v_has_more := true;
    v_trimmed := (
      SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
      FROM (
        SELECT value
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
REVOKE ALL ON FUNCTION public.upsert_customer(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_customer_detail(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_customers(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_customer(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_detail(jsonb) TO authenticated;

-- Keep table write surface closed; SELECT policy already org-scoped.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.customers FROM anon, authenticated;
GRANT SELECT ON TABLE public.customers TO authenticated;

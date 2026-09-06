-- B20: server-authoritative commercial rules from store_settings.
-- Enforced in process_sale / upsert_customer so API/RPC cannot bypass UI checks.

CREATE OR REPLACE FUNCTION public.assert_store_sale_settings(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_store_id uuid;
  v_org_id uuid;
  v_customer_id uuid;
  v_cash_session_id uuid;
  v_require_customer boolean := false;
  v_require_cash boolean := false;
  v_require_document boolean := false;
  v_customer_org uuid;
  v_customer_document text;
  v_session public.cash_sessions%ROWTYPE;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_customer_id := NULLIF(p_payload->>'customer_id', '')::uuid;
    v_cash_session_id := NULLIF(p_payload->>'cash_session_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END;

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;

  SELECT s.org_id
  INTO v_org_id
  FROM public.stores s
  WHERE s.id = v_store_id
    AND s.is_active IS TRUE;

  IF v_org_id IS NULL
    OR v_org_id IS DISTINCT FROM public.current_user_org_id()
  THEN
    RAISE EXCEPTION 'store_access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT
    COALESCE(ss.require_customer_on_sale, false),
    COALESCE(ss.require_open_cash_session, false),
    COALESCE(ss.require_customer_document, false)
  INTO
    v_require_customer,
    v_require_cash,
    v_require_document
  FROM public.store_settings ss
  WHERE ss.store_id = v_store_id
    AND ss.org_id = v_org_id;

  IF NOT FOUND THEN
    v_require_customer := false;
    v_require_cash := false;
    v_require_document := false;
  END IF;

  IF v_require_customer AND v_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_required_on_sale' USING ERRCODE = '22023';
  END IF;

  IF v_customer_id IS NOT NULL THEN
    SELECT c.org_id, NULLIF(btrim(COALESCE(c.document, '')), '')
    INTO v_customer_org, v_customer_document
    FROM public.customers c
    WHERE c.id = v_customer_id;

    IF NOT FOUND OR v_customer_org IS DISTINCT FROM v_org_id THEN
      RAISE EXCEPTION 'customer_store_scope_mismatch' USING ERRCODE = '42501';
    END IF;

    IF v_require_document AND v_customer_document IS NULL THEN
      RAISE EXCEPTION 'customer_document_required' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- When require_open_cash_session is on, the caller MUST supply cash_session_id.
  -- Never fall back to "any open session for the store".
  IF v_require_cash THEN
    IF v_cash_session_id IS NULL THEN
      RAISE EXCEPTION 'cash_session_required' USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_session
    FROM public.cash_sessions cs
    WHERE cs.id = v_cash_session_id;

    IF NOT FOUND
      OR v_session.org_id IS DISTINCT FROM v_org_id
      OR v_session.store_id IS DISTINCT FROM v_store_id
      OR v_session.status <> 'open'
    THEN
      RAISE EXCEPTION 'cash_session_required' USING ERRCODE = '22023';
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_store_sale_settings(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_store_sale_settings(jsonb) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.process_sale(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_store_id uuid;
  v_client_mutation_id uuid;
  v_org_id uuid;
  v_discount numeric := 0;
  v_gross_subtotal numeric := 0;
  v_item jsonb;
  v_existing_sale_id uuid;
  v_status text;
  v_total numeric(12, 2);
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_sale_payload_integrity(p_payload);

  v_store_id := (p_payload->>'store_id')::uuid;
  v_client_mutation_id := (p_payload->>'client_mutation_id')::uuid;
  v_discount := COALESCE((p_payload->>'discount')::numeric, 0);

  IF v_store_id IS NULL OR v_client_mutation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF public.user_has_store_access(v_store_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'store_access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT s.org_id
  INTO v_org_id
  FROM public.stores s
  WHERE s.id = v_store_id
    AND s.is_active IS TRUE;

  IF v_org_id IS NULL
    OR v_org_id IS DISTINCT FROM public.current_user_org_id()
  THEN
    RAISE EXCEPTION 'store_access_denied' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_store_id::text || ':' || v_client_mutation_id::text, 0)
  );

  SELECT k.sale_id
  INTO v_existing_sale_id
  FROM public.sale_idempotency_keys k
  WHERE k.store_id = v_store_id
    AND k.client_mutation_id = v_client_mutation_id
  FOR UPDATE;

  IF v_existing_sale_id IS NULL THEN
    SELECT s.id
    INTO v_existing_sale_id
    FROM public.sales s
    WHERE s.store_id = v_store_id
      AND s.client_mutation_id = v_client_mutation_id
    FOR UPDATE;
  END IF;

  IF v_existing_sale_id IS NOT NULL THEN
    SELECT s.status::text, s.total
    INTO v_status, v_total
    FROM public.sales s
    WHERE s.id = v_existing_sale_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'idempotency_incomplete' USING ERRCODE = '40001';
    END IF;
    IF NOT public.sale_payload_matches(v_existing_sale_id, p_payload) THEN
      RAISE EXCEPTION 'idempotency_payload_mismatch' USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'sale_id', v_existing_sale_id,
      'client_mutation_id', v_client_mutation_id,
      'replay', true,
      'status', v_status,
      'total', v_total,
      'stock_reconciled', true
    );
  END IF;

  -- Commercial rules apply only to new sales (idempotent replay returns above).
  PERFORM public.assert_store_sale_settings(p_payload);

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb)) AS t(value)
  LOOP
    v_gross_subtotal := v_gross_subtotal + round(
      COALESCE((v_item->>'quantity')::numeric, 0)
      * COALESCE((v_item->>'unit_price')::numeric, 0),
      2
    );
    v_discount := v_discount + COALESCE((v_item->>'discount')::numeric, 0);
  END LOOP;

  PERFORM public.assert_sale_discount_cap(v_store_id, v_discount, v_gross_subtotal);

  RETURN public.process_sale_core(p_payload)
    || jsonb_build_object(
      'client_mutation_id', v_client_mutation_id,
      'stock_reconciled', true
    );
END;
$$;

REVOKE ALL ON FUNCTION public.process_sale(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_sale(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_sale(jsonb) TO authenticated;

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
  v_require_document boolean := false;
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

  SELECT COALESCE(ss.require_customer_document, false)
  INTO v_require_document
  FROM public.store_settings ss
  WHERE ss.store_id = v_store_id
    AND ss.org_id = v_org_id;

  IF NOT FOUND THEN
    v_require_document := false;
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

  IF v_require_document AND v_document IS NULL THEN
    RAISE EXCEPTION 'customer_document_required' USING ERRCODE = '22023';
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

REVOKE ALL ON FUNCTION public.upsert_customer(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_customer(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_customer(jsonb) TO authenticated;

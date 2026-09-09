-- PDV cash walk-in: null customer_id must succeed.
-- Prod-only assert_store_sale_settings raised customer_required_on_sale when
-- store_settings.require_customer_on_sale was true (Centro). Schema already
-- allows sales.customer_id NULL. HTTP still maps the token if a stale RPC
-- raises it. Local DBs without store_settings keep working (to_regclass).

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

  IF to_regclass('public.store_settings') IS NOT NULL THEN
    EXECUTE
      'SELECT COALESCE(require_open_cash_session, false),
              COALESCE(require_customer_document, false)
       FROM public.store_settings
       WHERE store_id = $1 AND org_id = $2'
      INTO v_require_cash, v_require_document
      USING v_store_id, v_org_id;
  END IF;

  -- Walk-in: never raise customer_required_on_sale.
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
REVOKE ALL ON FUNCTION public.assert_store_sale_settings(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.assert_store_sale_settings(jsonb) FROM authenticated;

DO $$
BEGIN
  IF to_regclass('public.store_settings') IS NOT NULL THEN
    EXECUTE 'UPDATE public.store_settings SET require_customer_on_sale = false
             WHERE require_customer_on_sale IS TRUE';
  END IF;
END;
$$;

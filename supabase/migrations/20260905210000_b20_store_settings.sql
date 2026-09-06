-- B20 — store / PDV operational settings (commercial identity + preferences).
-- Writes only via SECURITY DEFINER RPCs. No fiscal/payment provider secrets.

CREATE TABLE IF NOT EXISTS public.store_settings (
  store_id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  trade_name text,
  document text,
  phone text,
  address_line text,
  city text,
  state text,
  postal_code text,
  receipt_footer text,
  auto_print_receipt boolean NOT NULL DEFAULT false,
  show_operator_on_receipt boolean NOT NULL DEFAULT true,
  beep_on_scan boolean NOT NULL DEFAULT true,
  require_customer_on_sale boolean NOT NULL DEFAULT false,
  require_open_cash_session boolean NOT NULL DEFAULT false,
  require_customer_document boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  CONSTRAINT store_settings_store_scope_fk
    FOREIGN KEY (store_id, org_id)
    REFERENCES public.stores (id, org_id)
    ON DELETE CASCADE,
  CONSTRAINT store_settings_org_fk
    FOREIGN KEY (org_id)
    REFERENCES public.organizations (id)
    ON DELETE CASCADE,
  CONSTRAINT store_settings_trade_name_len
    CHECK (trade_name IS NULL OR length(btrim(trade_name)) BETWEEN 1 AND 120),
  CONSTRAINT store_settings_document_digits
    CHECK (
      document IS NULL
      OR (
        length(regexp_replace(document, '\D', '', 'g')) IN (11, 14)
        AND document = regexp_replace(document, '\D', '', 'g')
      )
    ),
  CONSTRAINT store_settings_phone_len
    CHECK (phone IS NULL OR length(regexp_replace(phone, '\D', '', 'g')) BETWEEN 10 AND 13),
  CONSTRAINT store_settings_address_len
    CHECK (address_line IS NULL OR length(btrim(address_line)) BETWEEN 1 AND 200),
  CONSTRAINT store_settings_city_len
    CHECK (city IS NULL OR length(btrim(city)) BETWEEN 1 AND 80),
  CONSTRAINT store_settings_state_uf
    CHECK (state IS NULL OR state ~ '^[A-Z]{2}$'),
  CONSTRAINT store_settings_postal_code
    CHECK (postal_code IS NULL OR postal_code ~ '^\d{8}$'),
  CONSTRAINT store_settings_footer_len
    CHECK (receipt_footer IS NULL OR length(btrim(receipt_footer)) BETWEEN 1 AND 240)
);

CREATE INDEX IF NOT EXISTS store_settings_org_idx
  ON public.store_settings (org_id);

ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_settings_select ON public.store_settings;
CREATE POLICY store_settings_select ON public.store_settings
  FOR SELECT TO authenticated
  USING (public.user_has_store_access(store_id) IS TRUE);

REVOKE ALL ON TABLE public.store_settings FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.store_settings FROM anon, authenticated;
GRANT SELECT ON TABLE public.store_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.default_store_settings_json(
  p_store_id uuid,
  p_org_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RETURN jsonb_build_object(
    'store_id', p_store_id,
    'org_id', p_org_id,
    'trade_name', NULL,
    'document', NULL,
    'phone', NULL,
    'address_line', NULL,
    'city', NULL,
    'state', NULL,
    'postal_code', NULL,
    'receipt_footer', NULL,
    'auto_print_receipt', false,
    'show_operator_on_receipt', true,
    'beep_on_scan', true,
    'require_customer_on_sale', false,
    'require_open_cash_session', false,
    'require_customer_document', false,
    'updated_at', NULL,
    'updated_by', NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.store_settings_row_json(p_row public.store_settings)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RETURN jsonb_build_object(
    'store_id', p_row.store_id,
    'org_id', p_row.org_id,
    'trade_name', p_row.trade_name,
    'document', p_row.document,
    'phone', p_row.phone,
    'address_line', p_row.address_line,
    'city', p_row.city,
    'state', p_row.state,
    'postal_code', p_row.postal_code,
    'receipt_footer', p_row.receipt_footer,
    'auto_print_receipt', p_row.auto_print_receipt,
    'show_operator_on_receipt', p_row.show_operator_on_receipt,
    'beep_on_scan', p_row.beep_on_scan,
    'require_customer_on_sale', p_row.require_customer_on_sale,
    'require_open_cash_session', p_row.require_open_cash_session,
    'require_customer_document', p_row.require_customer_document,
    'updated_at', p_row.updated_at,
    'updated_by', p_row.updated_by
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_store_settings(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_org_id uuid;
  v_role public.member_role;
  v_store public.stores%ROWTYPE;
  v_org public.organizations%ROWTYPE;
  v_settings public.store_settings%ROWTYPE;
  v_settings_json jsonb;
  v_can_edit boolean := false;
BEGIN
  IF v_user_id IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_settings_query' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_settings_query' USING ERRCODE = '22023';
  END;

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'invalid_settings_query' USING ERRCODE = '22023';
  END IF;

  SELECT s.*
  INTO v_store
  FROM public.stores s
  WHERE s.id = v_store_id
    AND s.is_active IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden_settings' USING ERRCODE = '42501';
  END IF;

  v_org_id := v_store.org_id;
  v_role := public.user_store_role(v_store_id);

  IF v_org_id IS DISTINCT FROM public.current_user_org_id()
    OR v_role IS NULL
  THEN
    RAISE EXCEPTION 'forbidden_settings' USING ERRCODE = '42501';
  END IF;

  SELECT o.*
  INTO v_org
  FROM public.organizations o
  WHERE o.id = v_org_id;

  SELECT ss.*
  INTO v_settings
  FROM public.store_settings ss
  WHERE ss.store_id = v_store_id
    AND ss.org_id = v_org_id;

  IF FOUND THEN
    v_settings_json := public.store_settings_row_json(v_settings);
  ELSE
    v_settings_json := public.default_store_settings_json(v_store_id, v_org_id);
  END IF;

  v_can_edit := v_role IN ('admin', 'manager');

  RETURN jsonb_build_object(
    'settings', v_settings_json,
    'store', jsonb_build_object(
      'id', v_store.id,
      'name', v_store.name,
      'code', v_store.code,
      'is_active', v_store.is_active
    ),
    'organization', jsonb_build_object(
      'id', v_org.id,
      'name', v_org.name,
      'currency', v_org.currency,
      'timezone', v_org.timezone
    ),
    'can_edit', v_can_edit,
    'role', v_role::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_store_settings(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_org_id uuid;
  v_role public.member_role;
  v_trade_name text;
  v_document text;
  v_phone text;
  v_address_line text;
  v_city text;
  v_state text;
  v_postal_code text;
  v_receipt_footer text;
  v_auto_print boolean;
  v_show_operator boolean;
  v_beep boolean;
  v_require_customer boolean;
  v_require_cash boolean;
  v_require_document boolean;
  v_row public.store_settings%ROWTYPE;
BEGIN
  IF v_user_id IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_settings_payload' USING ERRCODE = '22023';
  END IF;

  -- Never trust client-supplied org_id.
  IF p_payload ? 'org_id' OR p_payload ? 'organization_id' THEN
    RAISE EXCEPTION 'invalid_settings_payload' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_settings_payload' USING ERRCODE = '22023';
  END;

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'invalid_settings_payload' USING ERRCODE = '22023';
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
    OR v_role NOT IN ('admin', 'manager')
  THEN
    RAISE EXCEPTION 'forbidden_settings' USING ERRCODE = '42501';
  END IF;

  v_trade_name := NULLIF(btrim(COALESCE(p_payload->>'trade_name', '')), '');
  v_document := NULLIF(btrim(COALESCE(p_payload->>'document', '')), '');
  v_phone := NULLIF(btrim(COALESCE(p_payload->>'phone', '')), '');
  v_address_line := NULLIF(btrim(COALESCE(p_payload->>'address_line', '')), '');
  v_city := NULLIF(btrim(COALESCE(p_payload->>'city', '')), '');
  v_state := NULLIF(upper(btrim(COALESCE(p_payload->>'state', ''))), '');
  v_postal_code := NULLIF(btrim(COALESCE(p_payload->>'postal_code', '')), '');
  v_receipt_footer := NULLIF(btrim(COALESCE(p_payload->>'receipt_footer', '')), '');

  IF v_trade_name IS NOT NULL AND length(v_trade_name) > 120 THEN
    RAISE EXCEPTION 'invalid_settings_trade_name' USING ERRCODE = '22023';
  END IF;

  IF v_document IS NOT NULL THEN
    v_document := regexp_replace(v_document, '\D', '', 'g');
    IF v_document !~ '^\d{11}$' AND v_document !~ '^\d{14}$' THEN
      RAISE EXCEPTION 'invalid_settings_document' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_phone IS NOT NULL THEN
    v_phone := regexp_replace(v_phone, '[^\d+]', '', 'g');
    IF length(regexp_replace(v_phone, '\D', '', 'g')) < 10
      OR length(regexp_replace(v_phone, '\D', '', 'g')) > 13
    THEN
      RAISE EXCEPTION 'invalid_settings_phone' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_address_line IS NOT NULL AND length(v_address_line) > 200 THEN
    RAISE EXCEPTION 'invalid_settings_address' USING ERRCODE = '22023';
  END IF;

  IF v_city IS NOT NULL AND length(v_city) > 80 THEN
    RAISE EXCEPTION 'invalid_settings_city' USING ERRCODE = '22023';
  END IF;

  IF v_state IS NOT NULL AND v_state !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'invalid_settings_state' USING ERRCODE = '22023';
  END IF;

  IF v_postal_code IS NOT NULL THEN
    v_postal_code := regexp_replace(v_postal_code, '\D', '', 'g');
    IF v_postal_code !~ '^\d{8}$' THEN
      RAISE EXCEPTION 'invalid_settings_postal_code' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_receipt_footer IS NOT NULL AND length(v_receipt_footer) > 240 THEN
    RAISE EXCEPTION 'invalid_settings_footer' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_auto_print := COALESCE((p_payload->>'auto_print_receipt')::boolean, false);
    v_show_operator := COALESCE((p_payload->>'show_operator_on_receipt')::boolean, true);
    v_beep := COALESCE((p_payload->>'beep_on_scan')::boolean, true);
    v_require_customer := COALESCE((p_payload->>'require_customer_on_sale')::boolean, false);
    v_require_cash := COALESCE((p_payload->>'require_open_cash_session')::boolean, false);
    v_require_document := COALESCE((p_payload->>'require_customer_document')::boolean, false);
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_settings_payload' USING ERRCODE = '22023';
  END;

  INSERT INTO public.store_settings (
    store_id,
    org_id,
    trade_name,
    document,
    phone,
    address_line,
    city,
    state,
    postal_code,
    receipt_footer,
    auto_print_receipt,
    show_operator_on_receipt,
    beep_on_scan,
    require_customer_on_sale,
    require_open_cash_session,
    require_customer_document,
    updated_at,
    updated_by
  )
  VALUES (
    v_store_id,
    v_org_id,
    v_trade_name,
    v_document,
    v_phone,
    v_address_line,
    v_city,
    v_state,
    v_postal_code,
    v_receipt_footer,
    v_auto_print,
    v_show_operator,
    v_beep,
    v_require_customer,
    v_require_cash,
    v_require_document,
    now(),
    v_user_id
  )
  ON CONFLICT (store_id) DO UPDATE
  SET trade_name = EXCLUDED.trade_name,
      document = EXCLUDED.document,
      phone = EXCLUDED.phone,
      address_line = EXCLUDED.address_line,
      city = EXCLUDED.city,
      state = EXCLUDED.state,
      postal_code = EXCLUDED.postal_code,
      receipt_footer = EXCLUDED.receipt_footer,
      auto_print_receipt = EXCLUDED.auto_print_receipt,
      show_operator_on_receipt = EXCLUDED.show_operator_on_receipt,
      beep_on_scan = EXCLUDED.beep_on_scan,
      require_customer_on_sale = EXCLUDED.require_customer_on_sale,
      require_open_cash_session = EXCLUDED.require_open_cash_session,
      require_customer_document = EXCLUDED.require_customer_document,
      updated_at = now(),
      updated_by = v_user_id
  RETURNING * INTO v_row;

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
    'store_settings',
    v_store_id,
    'store_settings.updated',
    jsonb_build_object(
      'trade_name', v_row.trade_name,
      'auto_print_receipt', v_row.auto_print_receipt,
      'require_customer_on_sale', v_row.require_customer_on_sale,
      'require_open_cash_session', v_row.require_open_cash_session,
      'require_customer_document', v_row.require_customer_document
    )
  );

  RETURN public.get_store_settings(jsonb_build_object('store_id', v_store_id));
END;
$$;

REVOKE ALL ON FUNCTION public.default_store_settings_json(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.store_settings_row_json(public.store_settings) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_store_settings(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_store_settings(jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_store_settings(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_store_settings(jsonb) TO authenticated;

-- Formas de pagamento manuais por loja.
-- A loja marca o que aceita (dinheiro, PIX próprio, débito e crédito na
-- maquininha própria). A venda só registra a forma escolhida: nada é cobrado
-- online. Os métodos cash, pix_manual e voucher continuam aceitos.

ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'debito_manual';
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'credito_manual';

ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS accepted_payment_methods text[] NOT NULL
    DEFAULT ARRAY['cash', 'pix_manual', 'debito_manual', 'credito_manual']::text[];

ALTER TABLE public.store_settings
  DROP CONSTRAINT IF EXISTS store_settings_accepted_payment_methods_check;
ALTER TABLE public.store_settings
  ADD CONSTRAINT store_settings_accepted_payment_methods_check
    CHECK (
      cardinality(accepted_payment_methods) >= 1
      AND accepted_payment_methods <@ ARRAY['cash', 'pix_manual', 'debito_manual', 'credito_manual']::text[]
    );

COMMENT ON COLUMN public.store_settings.accepted_payment_methods IS
  'Formas aceitas no PDV, só marcação (sem integração): cash, pix_manual, debito_manual, credito_manual.';

-- Aceita os novos métodos nas funções de venda (patch textual da lista).
DO $$
DECLARE
  v_def text;
  v_new text;
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public.process_sale_core(jsonb)', 'public.process_sale_with_cash(jsonb)'] LOOP
    v_def := pg_get_functiondef(v_fn::regprocedure);
    IF position('''debito_manual''::public.payment_method' IN v_def) > 0 THEN
      CONTINUE;
    END IF;
    v_new := replace(
      v_def,
      '''pix_manual''::public.payment_method,',
      '''pix_manual''::public.payment_method, ''debito_manual''::public.payment_method, ''credito_manual''::public.payment_method,'
    );
    IF v_new = v_def THEN
      RAISE EXCEPTION 'payment_method_allowlist_not_found in %', v_fn;
    END IF;
    EXECUTE v_new;
  END LOOP;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'assert_sale_payload_integrity'
  LIMIT 1;
  IF v_def IS NOT NULL AND position('''debito_manual''' IN v_def) = 0 THEN
    v_new := replace(
      v_def,
      'NOT IN (''cash'', ''pix_manual'', ''voucher'')',
      'NOT IN (''cash'', ''pix_manual'', ''debito_manual'', ''credito_manual'', ''voucher'')'
    );
    IF v_new = v_def THEN
      RAISE EXCEPTION 'payment_method_allowlist_not_found in assert_sale_payload_integrity';
    END IF;
    EXECUTE v_new;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.default_store_settings_json(p_store_id uuid, p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
    'accepted_payment_methods', to_jsonb(ARRAY['cash', 'pix_manual', 'debito_manual', 'credito_manual']::text[]),
    'updated_at', NULL,
    'updated_by', NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.store_settings_row_json(p_row store_settings)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
    'accepted_payment_methods', to_jsonb(p_row.accepted_payment_methods),
    'updated_at', p_row.updated_at,
    'updated_by', p_row.updated_by
  );
END;
$function$;

-- Só admin/gerente da loja marca as formas aceitas.
CREATE OR REPLACE FUNCTION public.set_store_payment_methods(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_org_id uuid;
  v_role public.member_role;
  v_methods text[];
  v_row public.store_settings%ROWTYPE;
BEGIN
  IF v_user_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR jsonb_typeof(p_payload->'accepted_payment_methods') IS DISTINCT FROM 'array'
     OR p_payload ? 'org_id'
  THEN
    RAISE EXCEPTION 'invalid_settings_payload' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'invalid_settings_payload' USING ERRCODE = '22023';
  END;
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'invalid_settings_payload' USING ERRCODE = '22023';
  END IF;

  SELECT s.org_id INTO v_org_id FROM public.stores s
  WHERE s.id = v_store_id AND s.is_active IS TRUE;
  v_role := public.user_store_role(v_store_id);
  IF v_org_id IS NULL
    OR v_org_id IS DISTINCT FROM public.current_user_org_id()
    OR v_role IS NULL
    OR v_role NOT IN ('admin', 'manager')
  THEN
    RAISE EXCEPTION 'forbidden_settings' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT value ORDER BY value), ARRAY[]::text[]) INTO v_methods
  FROM jsonb_array_elements_text(p_payload->'accepted_payment_methods') AS value;
  IF cardinality(v_methods) < 1
     OR NOT (v_methods <@ ARRAY['cash', 'pix_manual', 'debito_manual', 'credito_manual']::text[])
  THEN
    RAISE EXCEPTION 'invalid_settings_payment_methods' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.store_settings (store_id, org_id, accepted_payment_methods, updated_at, updated_by)
  VALUES (v_store_id, v_org_id, v_methods, now(), v_user_id)
  ON CONFLICT (store_id) DO UPDATE
  SET accepted_payment_methods = EXCLUDED.accepted_payment_methods,
      updated_at = now(),
      updated_by = v_user_id
  RETURNING * INTO v_row;

  RETURN public.store_settings_row_json(v_row);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_store_payment_methods(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_store_payment_methods(jsonb) TO authenticated;

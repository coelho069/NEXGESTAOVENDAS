-- Admin/gerente da loja renomeia a própria loja (nome exibido no PDV e no recibo).
CREATE OR REPLACE FUNCTION public.set_store_name(p_payload jsonb)
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
  v_name text;
BEGIN
  IF v_user_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
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

  v_name := btrim(regexp_replace(COALESCE(p_payload->>'name', ''), '\s+', ' ', 'g'));
  IF char_length(v_name) < 2 OR char_length(v_name) > 80 THEN
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

  UPDATE public.stores
  SET name = v_name, updated_at = now()
  WHERE id = v_store_id;

  RETURN jsonb_build_object('store_id', v_store_id, 'name', v_name);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_store_name(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_store_name(jsonb) TO authenticated;

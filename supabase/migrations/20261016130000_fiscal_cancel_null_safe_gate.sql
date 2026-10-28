-- Remediação (remediation-1, revisão D F2): request_fiscal_cancel usava
--   IF user_store_role(v_store_id) NOT IN ('admin','manager') THEN ...
-- Para quem não tem vínculo com a loja, user_store_role devolve NULL e
-- "NULL NOT IN (...)" não dispara a exceção. A correção usa IS DISTINCT FROM,
-- igual a retry_fiscal_operation e request_fiscal_reconcile (20261016120000).
--
-- Corpo copiado mecanicamente da definição vigente (20260904114749, linhas 605-END)
-- com UMA única alteração: o gate de papel. Não altera GRANT (continua authenticated).
-- Idempotente (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.request_fiscal_cancel(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_document_id uuid;
  v_sale_id uuid;
  v_operation_id uuid;
  v_provider text;
  v_document public.fiscal_documents%ROWTYPE;
  v_outbox public.integration_outbox%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_fiscal_cancel_request' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_document_id := NULLIF(p_payload->>'fiscal_document_id', '')::uuid;
    v_sale_id := NULLIF(p_payload->>'sale_id', '')::uuid;
    v_operation_id := NULLIF(p_payload->>'operation_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_fiscal_cancel_request' USING ERRCODE = '22023';
  END;
  v_provider := NULLIF(btrim(p_payload->>'provider'), '');

  IF v_store_id IS NULL OR (v_document_id IS NULL AND v_sale_id IS NULL) OR v_provider IS NULL THEN
    RAISE EXCEPTION 'invalid_fiscal_cancel_request' USING ERRCODE = '22023';
  END IF;
  IF public.user_store_role(v_store_id) IS DISTINCT FROM 'admin' AND public.user_store_role(v_store_id) IS DISTINCT FROM 'manager' THEN
    RAISE EXCEPTION 'fiscal_cancel_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT fd.*
  INTO v_document
  FROM public.fiscal_documents fd
  WHERE fd.store_id = v_store_id
    AND fd.org_id = public.current_user_org_id()
    AND (v_document_id IS NULL OR fd.id = v_document_id)
    AND (v_sale_id IS NULL OR fd.sale_id = v_sale_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fiscal_document_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_provider = 'not_configured' THEN
    PERFORM public.append_fiscal_audit(
      v_document.id,
      'fiscal.cancel.requested',
      jsonb_build_object(
        'provider', 'not_configured',
        'status', 'not_configured',
        'operation', 'cancel'
      )
    );
    RETURN jsonb_build_object(
      'fiscal_document_id', v_document.id,
      'sale_id', v_document.sale_id,
      'status', 'not_configured',
      'provider', 'not_configured',
      'replay', true
    );
  END IF;

  IF v_document.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'fiscal_document_id', v_document.id,
      'sale_id', v_document.sale_id,
      'status', 'cancelled',
      'provider', v_document.adapter,
      'replay', true
    );
  END IF;
  IF v_document.status <> 'issued' THEN
    RAISE EXCEPTION 'fiscal_cancel_requires_issued'
      USING ERRCODE = '23514';
  END IF;

  v_operation_id := COALESCE(
    v_operation_id,
    md5(v_document.id::text || ':cancel')::uuid
  );

  SELECT *
  INTO v_outbox
  FROM public.integration_outbox
  WHERE fiscal_document_id = v_document.id
    AND operation_type = 'cancel'
    AND operation_id = v_operation_id
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'fiscal_document_id', v_document.id,
      'sale_id', v_document.sale_id,
      'operation_id', v_outbox.operation_id,
      'outbox_id', v_outbox.id,
      'status', v_document.status,
      'provider', v_outbox.provider,
      'replay', true
    );
  END IF;

  UPDATE public.fiscal_documents
  SET adapter = v_provider,
      status = 'pending',
      operation_id = v_operation_id,
      last_operation = 'cancel',
      attempt_count = 0,
      last_error = NULL,
      requested_at = now(),
      unknown_at = NULL
  WHERE id = v_document.id
  RETURNING * INTO v_document;

  INSERT INTO public.integration_outbox (
    org_id,
    store_id,
    fiscal_document_id,
    operation_id,
    operation_type,
    provider,
    idempotency_key
  )
  VALUES (
    v_document.org_id,
    v_document.store_id,
    v_document.id,
    v_operation_id,
    'cancel',
    v_provider,
    'fiscal:' || v_document.id::text || ':cancel:' || v_operation_id::text
  )
  RETURNING * INTO v_outbox;

  PERFORM public.append_fiscal_audit(
    v_document.id,
    'fiscal.cancel.requested',
    jsonb_build_object(
      'provider', v_provider,
      'operation_id', v_operation_id,
      'outbox_id', v_outbox.id,
      'status', v_document.status,
      'attempt', 0
    )
  );

  RETURN jsonb_build_object(
    'fiscal_document_id', v_document.id,
    'sale_id', v_document.sale_id,
    'operation_id', v_operation_id,
    'outbox_id', v_outbox.id,
    'status', v_document.status,
    'provider', v_provider,
    'replay', false
  );
END;
$$;

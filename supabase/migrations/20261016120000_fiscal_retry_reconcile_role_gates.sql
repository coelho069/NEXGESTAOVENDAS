-- Remediação P0 (run-5, agente A, A2): retry_fiscal_operation e
-- request_fiscal_reconcile autorizavam qualquer membro da loja (inclusive client)
-- via user_has_store_access. Passam a exigir admin|manager, como
-- request_fiscal_cancel e canManageFiscal (rbac.ts). Comparação NULL-safe
-- (IS DISTINCT FROM) para não liberar não-membros. Corpo copiado da definição
-- vigente (20260904114749); demais controles, SECURITY DEFINER e search_path preservados.

CREATE OR REPLACE FUNCTION public.retry_fiscal_operation(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_store_id uuid;
  v_document_id uuid;
  v_operation_id uuid;
  v_document public.fiscal_documents%ROWTYPE;
  v_outbox public.integration_outbox%ROWTYPE;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_document_id := NULLIF(p_payload->>'fiscal_document_id', '')::uuid;
    v_operation_id := NULLIF(p_payload->>'operation_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_fiscal_retry' USING ERRCODE = '22023';
  END;
  IF v_store_id IS NULL OR v_document_id IS NULL THEN
    RAISE EXCEPTION 'invalid_fiscal_retry' USING ERRCODE = '22023';
  END IF;
  IF public.user_store_role(v_store_id) IS DISTINCT FROM 'admin'
    AND public.user_store_role(v_store_id) IS DISTINCT FROM 'manager'
  THEN
    RAISE EXCEPTION 'fiscal_access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_document
  FROM public.fiscal_documents
  WHERE id = v_document_id
    AND store_id = v_store_id
    AND org_id = public.current_user_org_id()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fiscal_document_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_document.status = 'unknown' THEN
    RAISE EXCEPTION 'fiscal_reconciliation_required' USING ERRCODE = '40901';
  END IF;
  IF v_document.last_operation IS NULL THEN
    RAISE EXCEPTION 'fiscal_operation_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_outbox
  FROM public.integration_outbox
  WHERE fiscal_document_id = v_document.id
    AND operation_type = v_document.last_operation
    AND (v_operation_id IS NULL OR operation_id = v_operation_id)
  ORDER BY created_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fiscal_operation_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_outbox.status = 'unknown' THEN
    RAISE EXCEPTION 'fiscal_reconciliation_required' USING ERRCODE = '40901';
  END IF;
  IF v_outbox.status = 'completed' THEN
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
  SET status = 'pending',
      last_error = NULL,
      requested_at = now()
  WHERE id = v_document.id
  RETURNING * INTO v_document;

  UPDATE public.integration_outbox
  SET status = 'pending',
      next_attempt_at = now(),
      last_error = NULL
  WHERE id = v_outbox.id
  RETURNING * INTO v_outbox;

  PERFORM public.append_fiscal_audit(
    v_document.id,
    CASE v_outbox.operation_type
      WHEN 'issue' THEN 'fiscal.issue.requested'
      WHEN 'cancel' THEN 'fiscal.cancel.requested'
      ELSE 'fiscal.reconcile'
    END,
    jsonb_build_object(
      'provider', v_outbox.provider,
      'operation_id', v_outbox.operation_id,
      'outbox_id', v_outbox.id,
      'status', v_document.status,
      'retry', true,
      'attempt', v_outbox.attempt_count
    )
  );

  RETURN jsonb_build_object(
    'fiscal_document_id', v_document.id,
    'sale_id', v_document.sale_id,
    'operation_id', v_outbox.operation_id,
    'outbox_id', v_outbox.id,
    'status', v_document.status,
    'provider', v_outbox.provider,
    'replay', false,
    'retry', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.request_fiscal_reconcile(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_store_id uuid;
  v_document_id uuid;
  v_sale_id uuid;
  v_document public.fiscal_documents%ROWTYPE;
  v_outbox public.integration_outbox%ROWTYPE;
  v_operation_id uuid;
  v_provider text;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_fiscal_reconciliation' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_document_id := NULLIF(p_payload->>'fiscal_document_id', '')::uuid;
    v_sale_id := NULLIF(p_payload->>'sale_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_fiscal_reconciliation' USING ERRCODE = '22023';
  END;

  IF v_store_id IS NULL OR (v_document_id IS NULL AND v_sale_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_fiscal_reconciliation' USING ERRCODE = '22023';
  END IF;
  IF public.user_store_role(v_store_id) IS DISTINCT FROM 'admin'
    AND public.user_store_role(v_store_id) IS DISTINCT FROM 'manager'
  THEN
    RAISE EXCEPTION 'fiscal_access_denied' USING ERRCODE = '42501';
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

  IF v_document.status <> 'unknown' THEN
    RETURN jsonb_build_object(
      'fiscal_document_id', v_document.id,
      'sale_id', v_document.sale_id,
      'status', v_document.status,
      'provider', v_document.adapter,
      'replay', true,
      'reconciled', false
    );
  END IF;

  v_provider := NULLIF(btrim(v_document.adapter), '');
  IF v_provider IS NULL OR v_provider = 'not_configured' THEN
    RETURN jsonb_build_object(
      'fiscal_document_id', v_document.id,
      'sale_id', v_document.sale_id,
      'status', 'not_configured',
      'provider', 'not_configured',
      'replay', true,
      'reconciled', false
    );
  END IF;

  v_operation_id := md5(
    v_document.id::text || ':consult:' || COALESCE(v_document.operation_id::text, '')
  )::uuid;

  SELECT *
  INTO v_outbox
  FROM public.integration_outbox
  WHERE fiscal_document_id = v_document.id
    AND operation_type = 'consult'
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
      'replay', true,
      'reconciled', false
    );
  END IF;

  UPDATE public.fiscal_documents
  SET status = 'pending',
      operation_id = v_operation_id,
      last_operation = 'consult',
      attempt_count = 0,
      last_error = NULL,
      requested_at = now()
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
    'consult',
    v_provider,
    'fiscal:' || v_document.id::text || ':consult:' || v_operation_id::text
  )
  RETURNING * INTO v_outbox;

  PERFORM public.append_fiscal_audit(
    v_document.id,
    'fiscal.reconcile',
    jsonb_build_object(
      'provider', v_provider,
      'operation_id', v_operation_id,
      'outbox_id', v_outbox.id,
      'from_status', 'unknown',
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
    'replay', false,
    'reconciled', false
  );
END;
$$;


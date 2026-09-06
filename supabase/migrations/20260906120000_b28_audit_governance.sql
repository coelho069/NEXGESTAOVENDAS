-- B28 — Audit governance RPCs over existing public.audit_logs.
-- Append-only: authenticated cannot INSERT/UPDATE/DELETE (already revoked).
-- Writers: SECURITY DEFINER record_audit_event.
-- Readers: SECURITY DEFINER list_audit_events (manager/admin via user_can_view_reports).

CREATE INDEX IF NOT EXISTS idx_audit_logs_store_created
  ON public.audit_logs (store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created
  ON public.audit_logs (org_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_created
  ON public.audit_logs (store_id, entity_type, entity_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.record_audit_event(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_org_id uuid;
  v_action text;
  v_entity_type text;
  v_entity_id uuid;
  v_payload jsonb;
  v_result text;
  v_id uuid;
BEGIN
  IF v_user_id IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_audit_payload' USING ERRCODE = '22023';
  END IF;

  -- Never trust client-supplied org/user/time/result authority fields.
  IF p_payload ? 'org_id'
    OR p_payload ? 'organization_id'
    OR p_payload ? 'user_id'
    OR p_payload ? 'actor_user_id'
    OR p_payload ? 'actor_role'
    OR p_payload ? 'occurred_at'
    OR p_payload ? 'created_at'
    OR p_payload ? 'id'
    OR p_payload ? 'result'
  THEN
    RAISE EXCEPTION 'invalid_audit_payload' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_entity_id := NULLIF(p_payload->>'entity_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_audit_payload' USING ERRCODE = '22023';
  END;

  v_action := NULLIF(btrim(COALESCE(p_payload->>'action', '')), '');
  v_entity_type := NULLIF(btrim(COALESCE(p_payload->>'entity_type', '')), '');

  IF v_store_id IS NULL
    OR v_entity_id IS NULL
    OR v_action IS NULL
    OR v_entity_type IS NULL
    OR length(v_action) > 120
    OR length(v_entity_type) > 80
  THEN
    RAISE EXCEPTION 'invalid_audit_payload' USING ERRCODE = '22023';
  END IF;

  SELECT s.org_id
  INTO v_org_id
  FROM public.stores s
  WHERE s.id = v_store_id
    AND s.is_active IS TRUE;

  IF v_org_id IS NULL
    OR v_org_id IS DISTINCT FROM public.current_user_org_id()
    OR public.user_has_store_access(v_store_id) IS NOT TRUE
  THEN
    RAISE EXCEPTION 'forbidden_audit' USING ERRCODE = '42501';
  END IF;

  -- Generic writer is only for app-layer governance events.
  -- Domain sales/payments/cash/inventory/customer audits stay in their own RPCs.
  IF v_action NOT IN (
    'security.access_denied',
    'security.auth_failed',
    'audit.listed',
    'settings.updated',
    'printer.configuration_updated',
    'backup.attestation_updated',
    'fiscal.issue_requested',
    'fiscal.cancel_requested'
  ) THEN
    RAISE EXCEPTION 'invalid_audit_payload' USING ERRCODE = '22023';
  END IF;

  -- RBAC: cashiers may only record security denials/auth failures.
  -- Privileged governance actions require manager/admin (user_can_view_reports).
  IF v_action IN (
    'audit.listed',
    'settings.updated',
    'printer.configuration_updated',
    'backup.attestation_updated',
    'fiscal.issue_requested',
    'fiscal.cancel_requested'
  ) THEN
    IF public.user_can_view_reports(v_store_id) IS NOT TRUE THEN
      RAISE EXCEPTION 'forbidden_audit' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_payload := COALESCE(p_payload->'payload', '{}'::jsonb);
  IF jsonb_typeof(v_payload) <> 'object' THEN
    v_payload := '{}'::jsonb;
  END IF;

  v_result := NULLIF(btrim(COALESCE(v_payload->>'result', '')), '');
  IF v_result IS NULL OR v_result NOT IN ('success', 'failure', 'rejected', 'denied') THEN
    RAISE EXCEPTION 'invalid_audit_payload' USING ERRCODE = '22023';
  END IF;

  -- Access-denied events cannot be recorded as success/failure/rejected.
  IF v_action = 'security.access_denied' AND v_result IS DISTINCT FROM 'denied' THEN
    RAISE EXCEPTION 'invalid_audit_payload' USING ERRCODE = '22023';
  END IF;
  IF v_action = 'security.auth_failed' AND v_result NOT IN ('denied', 'failure') THEN
    RAISE EXCEPTION 'invalid_audit_payload' USING ERRCODE = '22023';
  END IF;

  -- Strict payload allowlist: drop any client key outside the contract.
  v_payload := jsonb_strip_nulls(
    jsonb_build_object(
      'result', v_result,
      'correlation_id', NULLIF(btrim(COALESCE(v_payload->>'correlation_id', '')), ''),
      'operation_id', NULLIF(btrim(COALESCE(v_payload->>'operation_id', '')), ''),
      'metadata', CASE
        WHEN jsonb_typeof(v_payload->'metadata') = 'object' THEN v_payload->'metadata'
        ELSE '{}'::jsonb
      END
    )
  );

  -- Strip secrets / PII keys from metadata (defense in depth).
  IF v_payload ? 'metadata' AND jsonb_typeof(v_payload->'metadata') = 'object' THEN
    v_payload := jsonb_set(
      v_payload,
      '{metadata}',
      (v_payload->'metadata')
        - 'password'
        - 'secret'
        - 'token'
        - 'api_key'
        - 'service_role'
        - 'jwt'
        - 'refresh_token'
        - 'access_token'
        - 'webhook'
        - 'webhook_url'
        - 'cvv'
        - 'pan'
        - 'card_number'
        - 'cpf'
        - 'cnpj'
        - 'document'
        - 'phone'
        - 'address'
        - 'email'
        - 'actor_user_id'
        - 'actor_role'
        - 'org_id'
        - 'organization_id'
        - 'user_id'
    );
  END IF;

  -- Bound metadata size to avoid unbounded audit rows.
  IF octet_length(COALESCE(v_payload::text, '')) > 8192 THEN
    RAISE EXCEPTION 'invalid_audit_payload' USING ERRCODE = '22023';
  END IF;

  -- Actor role is always derived from membership — never from the client body.
  v_payload := jsonb_set(
    v_payload,
    '{actor_role}',
    to_jsonb(public.user_store_role(v_store_id)::text),
    true
  );

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
    v_entity_type,
    v_entity_id,
    v_action,
    v_payload
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_audit_events(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_org_id uuid;
  v_action text;
  v_actions text[];
  v_entity_type text;
  v_entity_id uuid;
  v_actor uuid;
  v_result text;
  v_from timestamptz;
  v_to timestamptz;
  v_limit integer;
  v_offset integer;
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF v_user_id IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_audit_payload' USING ERRCODE = '22023';
  END IF;

  -- Never accept client-supplied org scope.
  IF p_payload ? 'org_id' OR p_payload ? 'organization_id' THEN
    RAISE EXCEPTION 'invalid_audit_payload' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_entity_id := NULLIF(p_payload->>'entity_id', '')::uuid;
    v_actor := NULLIF(p_payload->>'actor_user_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_audit_payload' USING ERRCODE = '22023';
  END;

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'invalid_audit_payload' USING ERRCODE = '22023';
  END IF;

  SELECT s.org_id
  INTO v_org_id
  FROM public.stores s
  WHERE s.id = v_store_id
    AND s.is_active IS TRUE;

  IF v_org_id IS NULL
    OR v_org_id IS DISTINCT FROM public.current_user_org_id()
    OR public.user_can_view_reports(v_store_id) IS NOT TRUE
  THEN
    RAISE EXCEPTION 'forbidden_audit' USING ERRCODE = '42501';
  END IF;

  v_action := NULLIF(btrim(COALESCE(p_payload->>'action', '')), '');
  v_entity_type := NULLIF(btrim(COALESCE(p_payload->>'entity_type', '')), '');
  v_result := NULLIF(btrim(COALESCE(p_payload->>'result', '')), '');

  IF v_result IS NOT NULL AND v_result NOT IN ('success', 'failure', 'rejected', 'denied') THEN
    RAISE EXCEPTION 'invalid_audit_payload' USING ERRCODE = '22023';
  END IF;

  -- Contract ↔ domain action aliases (single filter may match multiple persisted names).
  IF v_action IS NULL THEN
    v_actions := NULL;
  ELSE
    v_actions := ARRAY[v_action];
    IF v_action IN ('sale.created', 'sale.confirmed') THEN
      v_actions := ARRAY['sale.created', 'sale.confirmed'];
    ELSIF v_action IN ('inventory.adjusted', 'adjust_inventory') THEN
      v_actions := ARRAY['inventory.adjusted', 'adjust_inventory'];
    ELSIF v_action IN ('cash.movement', 'cash.movement_recorded', 'cash.sale_captured') THEN
      v_actions := ARRAY['cash.movement', 'cash.movement_recorded', 'cash.sale_captured'];
    ELSIF v_action IN ('settings.updated', 'store_settings.updated') THEN
      v_actions := ARRAY['settings.updated', 'store_settings.updated'];
    ELSIF v_action IN ('fiscal.issue_requested', 'fiscal.issue.requested') THEN
      v_actions := ARRAY['fiscal.issue_requested', 'fiscal.issue.requested'];
    ELSIF v_action IN ('fiscal.cancel_requested', 'fiscal.cancel.requested') THEN
      v_actions := ARRAY['fiscal.cancel_requested', 'fiscal.cancel.requested'];
    END IF;
  END IF;

  BEGIN
    v_from := NULLIF(p_payload->>'from', '')::timestamptz;
    v_to := NULLIF(p_payload->>'to', '')::timestamptz;
  EXCEPTION
    WHEN invalid_datetime_format THEN
      RAISE EXCEPTION 'invalid_audit_payload' USING ERRCODE = '22023';
  END;

  BEGIN
    v_limit := LEAST(GREATEST(COALESCE((p_payload->>'limit')::integer, 25), 1), 100);
    v_offset := GREATEST(COALESCE((p_payload->>'offset')::integer, 0), 0);
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_audit_payload' USING ERRCODE = '22023';
  END;

  SELECT count(*)
  INTO v_total
  FROM public.audit_logs a
  WHERE a.org_id = v_org_id
    AND a.store_id = v_store_id
    AND (v_actions IS NULL OR a.action = ANY (v_actions))
    AND (v_entity_type IS NULL OR a.entity_type = v_entity_type)
    AND (v_entity_id IS NULL OR a.entity_id = v_entity_id)
    AND (v_actor IS NULL OR a.user_id = v_actor)
    AND (v_result IS NULL OR COALESCE(a.payload->>'result', 'success') = v_result)
    AND (v_from IS NULL OR a.created_at >= v_from)
    AND (v_to IS NULL OR a.created_at <= v_to);

  SELECT COALESCE(jsonb_agg(row_to_json(q)::jsonb), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      a.id,
      a.created_at,
      a.org_id,
      a.store_id,
      a.user_id,
      a.entity_type,
      a.entity_id,
      a.action,
      a.payload
    FROM public.audit_logs a
    WHERE a.org_id = v_org_id
      AND a.store_id = v_store_id
      AND (v_actions IS NULL OR a.action = ANY (v_actions))
      AND (v_entity_type IS NULL OR a.entity_type = v_entity_type)
      AND (v_entity_id IS NULL OR a.entity_id = v_entity_id)
      AND (v_actor IS NULL OR a.user_id = v_actor)
      AND (v_result IS NULL OR COALESCE(a.payload->>'result', 'success') = v_result)
      AND (v_from IS NULL OR a.created_at >= v_from)
      AND (v_to IS NULL OR a.created_at <= v_to)
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT v_limit
    OFFSET v_offset
  ) q;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_audit_event(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_audit_event(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_audit_event(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.list_audit_events(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_audit_events(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_audit_events(jsonb) TO authenticated;

-- Reaffirm append-only: no UPDATE/DELETE for app roles.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.audit_logs FROM anon, authenticated;

-- B28: customer audit payloads must not store document/email/phone (PII minimization).
-- Domain response still returns those fields to authorized callers; audit keeps IDs/flags only.
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
  v_action text;
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

    v_action := 'customer.updated';
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

    v_action := 'customer.created';
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
    v_action,
    jsonb_build_object(
      'result', 'success',
      'actor_role', public.user_store_role(v_store_id)::text,
      'metadata', jsonb_build_object(
        'customer_id', v_existing.id,
        'has_document', v_existing.document IS NOT NULL,
        'has_email', v_existing.email IS NOT NULL,
        'has_phone', v_existing.phone IS NOT NULL
      )
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

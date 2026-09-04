-- Blocker 7: payment state integrity, provider evidence, and reconciliation.
--
-- Existing sale RPCs remain the single financial write path. This migration
-- adds a stable payment identity and a server-authoritative reconciliation
-- boundary without introducing a second checkout or outbox.

ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'unknown';

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS client_mutation_id uuid,
  ADD COLUMN IF NOT EXISTS failure_code text,
  ADD COLUMN IF NOT EXISTS unknown_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.payments p
SET
  client_mutation_id = s.client_mutation_id,
  updated_at = COALESCE(p.created_at, now())
FROM public.sales s
WHERE s.id = p.sale_id
  AND p.client_mutation_id IS NULL;

ALTER TABLE public.payments
  ALTER COLUMN client_mutation_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_sale_id_unique
  ON public.payments (sale_id);

CREATE UNIQUE INDEX IF NOT EXISTS payments_operation_key
  ON public.payments (org_id, store_id, client_mutation_id);

CREATE INDEX IF NOT EXISTS payments_reconciliation_idx
  ON public.payments (org_id, store_id, status, updated_at DESC);

CREATE OR REPLACE FUNCTION public.fill_payment_operation_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
BEGIN
  SELECT *
  INTO v_sale
  FROM public.sales
  WHERE id = NEW.sale_id
  FOR SHARE;

  IF NOT FOUND
    OR v_sale.org_id IS DISTINCT FROM NEW.org_id
  THEN
    RAISE EXCEPTION 'payment_sale_scope_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.client_mutation_id IS NULL THEN
    NEW.client_mutation_id := v_sale.client_mutation_id;
  ELSIF NEW.client_mutation_id IS DISTINCT FROM v_sale.client_mutation_id THEN
    RAISE EXCEPTION 'payment_identity_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
    AND (
      NEW.sale_id IS DISTINCT FROM OLD.sale_id
      OR NEW.client_mutation_id IS DISTINCT FROM OLD.client_mutation_id
      OR NEW.org_id IS DISTINCT FROM OLD.org_id
      OR NEW.store_id IS DISTINCT FROM OLD.store_id
    )
  THEN
    RAISE EXCEPTION 'payment_identity_immutable'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fill_payment_operation_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fill_payment_operation_identity() FROM anon;
REVOKE ALL ON FUNCTION public.fill_payment_operation_identity() FROM authenticated;

DROP TRIGGER IF EXISTS fill_payment_operation_identity ON public.payments;
CREATE TRIGGER fill_payment_operation_identity
  BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.fill_payment_operation_identity();

CREATE OR REPLACE FUNCTION public.assert_payment_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_previous text := OLD.status::text;
  v_next text := NEW.status::text;
  v_allowed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_next IN ('pending', 'authorized', 'captured', 'unknown') THEN
      IF v_next = 'unknown' AND NEW.unknown_at IS NULL THEN
        NEW.unknown_at := now();
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'invalid_initial_payment_status'
      USING ERRCODE = '23514';
  END IF;

  IF v_previous = v_next THEN
    RETURN NEW;
  END IF;

  v_allowed := CASE v_previous
    WHEN 'pending' THEN v_next IN ('authorized', 'captured', 'failed', 'unknown', 'cancelled')
    WHEN 'authorized' THEN v_next IN ('captured', 'unknown', 'cancelled')
    WHEN 'unknown' THEN v_next IN ('captured', 'failed', 'cancelled')
    WHEN 'captured' THEN v_next IN ('refunded')
    ELSE false
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'invalid_payment_status_transition'
      USING ERRCODE = '23514',
            DETAIL = format('%s -> %s', v_previous, v_next);
  END IF;

  IF v_next = 'unknown' THEN
    NEW.unknown_at := COALESCE(NEW.unknown_at, now());
  ELSE
    NEW.unknown_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_payment_status_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_payment_status_transition() FROM anon;
REVOKE ALL ON FUNCTION public.assert_payment_status_transition() FROM authenticated;

DROP TRIGGER IF EXISTS assert_payment_status_transition ON public.payments;
CREATE TRIGGER assert_payment_status_transition
  BEFORE INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_payment_status_transition();

CREATE OR REPLACE FUNCTION public.audit_payment_status_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_action text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'payment.created';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_action := 'payment.' || NEW.status::text;
  ELSE
    RETURN NEW;
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
    NEW.org_id,
    NEW.store_id,
    (SELECT auth.uid()),
    'payment',
    NEW.id,
    v_action,
    jsonb_build_object(
      'sale_id', NEW.sale_id,
      'client_mutation_id', NEW.client_mutation_id,
      'method', NEW.method,
      'status', NEW.status,
      'amount', NEW.amount,
      'adapter_status', NEW.adapter_status
    )
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_payment_status_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_payment_status_event() FROM anon;
REVOKE ALL ON FUNCTION public.audit_payment_status_event() FROM authenticated;

DROP TRIGGER IF EXISTS audit_payment_status_event ON public.payments;
CREATE TRIGGER audit_payment_status_event
  AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_payment_status_event();

CREATE TABLE IF NOT EXISTS public.payment_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  payment_id uuid NOT NULL,
  event_id text NOT NULL CHECK (length(btrim(event_id)) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('authorized', 'captured', 'failed', 'cancelled', 'refunded')),
  provider_reference text CHECK (
    provider_reference IS NULL OR length(provider_reference) BETWEEN 1 AND 200
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_provider_events_payment_scope_fk
    FOREIGN KEY (payment_id, org_id, store_id)
    REFERENCES public.payments (id, org_id, store_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_provider_events_identity_key
  ON public.payment_provider_events (org_id, store_id, event_id);

CREATE INDEX IF NOT EXISTS payment_provider_events_payment_idx
  ON public.payment_provider_events (payment_id, created_at DESC, id DESC);

ALTER TABLE public.payment_provider_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_provider_events_deny ON public.payment_provider_events;
CREATE POLICY payment_provider_events_deny
  ON public.payment_provider_events
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.payment_provider_events FROM PUBLIC;
REVOKE ALL ON TABLE public.payment_provider_events FROM anon;
REVOKE ALL ON TABLE public.payment_provider_events FROM authenticated;

CREATE OR REPLACE FUNCTION public.record_payment_provider_event(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_payment_id uuid;
  v_store_id uuid;
  v_event_id text;
  v_status text;
  v_provider_reference text;
  v_payment public.payments%ROWTYPE;
  v_existing public.payment_provider_events%ROWTYPE;
  v_event public.payment_provider_events%ROWTYPE;
BEGIN
  IF p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
    OR COALESCE(jsonb_typeof(p_payload->'payment_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'store_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'event_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'status') <> 'string', true)
  THEN
    RAISE EXCEPTION 'invalid_payment_provider_event'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_payment_id := NULLIF(p_payload->>'payment_id', '')::uuid;
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_payment_provider_event'
        USING ERRCODE = '22023';
  END;

  v_event_id := NULLIF(btrim(p_payload->>'event_id'), '');
  v_status := lower(NULLIF(btrim(p_payload->>'status'), ''));
  v_provider_reference := NULLIF(btrim(p_payload->>'provider_reference'), '');

  IF v_payment_id IS NULL
    OR v_store_id IS NULL
    OR v_event_id IS NULL
    OR v_status NOT IN ('authorized', 'captured', 'failed', 'cancelled', 'refunded')
  THEN
    RAISE EXCEPTION 'invalid_payment_provider_event'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE id = v_payment_id
    AND store_id = v_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_not_found'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.payment_provider_events
  WHERE org_id = v_payment.org_id
    AND store_id = v_store_id
    AND event_id = v_event_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.payment_id IS DISTINCT FROM v_payment_id
      OR v_existing.status IS DISTINCT FROM v_status
      OR v_existing.provider_reference IS DISTINCT FROM v_provider_reference
    THEN
      RAISE EXCEPTION 'payment_provider_event_mismatch'
        USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'payment_id', v_existing.payment_id,
      'event_id', v_existing.event_id,
      'status', v_existing.status,
      'replay', true
    );
  END IF;

  INSERT INTO public.payment_provider_events (
    org_id,
    store_id,
    payment_id,
    event_id,
    status,
    provider_reference
  )
  VALUES (
    v_payment.org_id,
    v_store_id,
    v_payment_id,
    v_event_id,
    v_status,
    v_provider_reference
  )
  RETURNING *
  INTO v_event;

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
    v_payment.org_id,
    v_store_id,
    (SELECT auth.uid()),
    'payment',
    v_payment_id,
    'payment.provider_event',
    jsonb_build_object(
      'event_id', v_event.event_id,
      'status', v_event.status,
      'provider_reference', v_event.provider_reference
    )
  );

  RETURN jsonb_build_object(
    'payment_id', v_event.payment_id,
    'event_id', v_event.event_id,
    'status', v_event.status,
    'replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_payment_provider_event(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_payment_provider_event(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.record_payment_provider_event(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment_provider_event(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_payment(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_payment_id uuid;
  v_client_mutation_id uuid;
  v_payment_status text;
  v_payment_method public.payment_method;
  v_payment_amount numeric(12, 2);
  v_payment_sale_id uuid;
  v_sale_status public.sale_status;
  v_sale_total numeric(12, 2);
  v_event_id text;
  v_event_status text;
  v_provider_reference text;
  v_updated public.payments%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = '42501';
  END IF;

  IF p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
    OR COALESCE(jsonb_typeof(p_payload->'store_id') <> 'string', true)
  THEN
    RAISE EXCEPTION 'invalid_payment_reconciliation'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_payment_id := NULLIF(p_payload->>'payment_id', '')::uuid;
    v_client_mutation_id := NULLIF(p_payload->>'client_mutation_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_payment_reconciliation'
        USING ERRCODE = '22023';
  END;

  IF v_store_id IS NULL
    OR (v_payment_id IS NULL AND v_client_mutation_id IS NULL)
  THEN
    RAISE EXCEPTION 'invalid_payment_reconciliation'
      USING ERRCODE = '22023';
  END IF;

  IF public.user_has_store_access(v_store_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'payment_access_denied'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    p.status::text,
    p.method,
    p.amount,
    p.sale_id,
    s.status,
    s.total
  INTO
    v_payment_status,
    v_payment_method,
    v_payment_amount,
    v_payment_sale_id,
    v_sale_status,
    v_sale_total
  FROM public.payments p
  JOIN public.sales s
    ON s.id = p.sale_id
   AND s.org_id = p.org_id
   AND s.store_id = p.store_id
  WHERE p.org_id = public.current_user_org_id()
    AND p.store_id = v_store_id
    AND (v_payment_id IS NULL OR p.id = v_payment_id)
    AND (v_client_mutation_id IS NULL OR p.client_mutation_id = v_client_mutation_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_not_found'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.id
  INTO v_payment_id
  FROM public.payments p
  WHERE p.org_id = public.current_user_org_id()
    AND p.store_id = v_store_id
    AND p.sale_id = v_payment_sale_id
  FOR UPDATE;

  IF v_payment_status IN ('captured', 'failed', 'cancelled', 'refunded') THEN
    RETURN jsonb_build_object(
      'payment_id', v_payment_id,
      'sale_id', v_payment_sale_id,
      'status', v_payment_status,
      'method', v_payment_method,
      'amount', v_payment_amount,
      'sale_status', v_sale_status,
      'total', v_sale_total,
      'replay', true,
      'reconciled', false,
      'pending', false,
      'evidence', true
    );
  END IF;

  SELECT
    e.event_id,
    e.status,
    e.provider_reference
  INTO
    v_event_id,
    v_event_status,
    v_provider_reference
  FROM public.payment_provider_events e
  WHERE e.payment_id = v_payment_id
    AND e.org_id = public.current_user_org_id()
    AND e.store_id = v_store_id
  ORDER BY e.created_at DESC, e.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'payment_id', v_payment_id,
      'sale_id', v_payment_sale_id,
      'status', v_payment_status,
      'method', v_payment_method,
      'amount', v_payment_amount,
      'sale_status', v_sale_status,
      'total', v_sale_total,
      'replay', false,
      'reconciled', false,
      'pending', true,
      'evidence', false
    );
  END IF;

  IF v_event_status IN ('failed', 'cancelled')
    AND v_sale_status NOT IN ('draft', 'pending_sync')
  THEN
    RAISE EXCEPTION 'payment_sale_state_conflict'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.payments
  SET
    status = v_event_status::public.payment_status,
    external_reference = COALESCE(v_provider_reference, external_reference),
    failure_code = CASE WHEN v_event_status = 'failed' THEN v_event_id ELSE NULL END,
    unknown_at = NULL,
    reconciled_at = now(),
    updated_at = now()
  WHERE id = v_payment_id
  RETURNING *
  INTO v_updated;

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
    v_updated.org_id,
    v_updated.store_id,
    v_user_id,
    'payment',
    v_updated.id,
    'payment.reconciled',
    jsonb_build_object(
      'sale_id', v_updated.sale_id,
      'client_mutation_id', v_updated.client_mutation_id,
      'event_id', v_event_id,
      'status', v_updated.status,
      'evidence', true
    )
  );

  RETURN jsonb_build_object(
    'payment_id', v_updated.id,
    'sale_id', v_updated.sale_id,
    'client_mutation_id', v_updated.client_mutation_id,
    'status', v_updated.status,
    'method', v_updated.method,
    'amount', v_updated.amount,
    'sale_status', v_sale_status,
    'total', v_sale_total,
    'replay', false,
    'reconciled', true,
    'pending', false,
    'evidence', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_payment(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_payment(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.reconcile_payment(jsonb) TO authenticated;

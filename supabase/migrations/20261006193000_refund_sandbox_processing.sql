-- Local-only sandbox settlement for a Mercado Pago refund.
-- Extends the analysis row so a mock provider can move approved -> processing -> refunded.
-- Does not call a provider, does not record a real financial effect, and must not
-- be applied to a remote database from this phase.

ALTER TABLE public.refund_requests
  ADD COLUMN IF NOT EXISTS provider_refund_id text,
  ADD COLUMN IF NOT EXISTS processing_error_class text,
  ADD COLUMN IF NOT EXISTS financial_effect boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.refund_requests.provider_refund_id IS
  'Sandbox provider id sandbox_<32 hex>. Assigned only after a mock confirmation.';
COMMENT ON COLUMN public.refund_requests.processing_error_class IS
  'temporary, permanent, or timeout. Null on dry-run and before a sandbox outcome.';
COMMENT ON COLUMN public.refund_requests.financial_effect IS
  'Always false in this phase. A sandbox confirmation is not a captured refund.';

ALTER TABLE public.refund_requests
  DROP CONSTRAINT IF EXISTS refund_requests_status_check,
  DROP CONSTRAINT IF EXISTS refund_requests_provider_refund_status_check,
  DROP CONSTRAINT IF EXISTS refund_requests_processing_shape_check,
  DROP CONSTRAINT IF EXISTS refund_requests_processing_terminal_check,
  DROP CONSTRAINT IF EXISTS refund_requests_financial_effect_false_check,
  DROP CONSTRAINT IF EXISTS refund_requests_processing_error_class_check,
  DROP CONSTRAINT IF EXISTS refund_requests_provider_refund_id_format_check;

DO $$
DECLARE
  legacy_name text;
  legacy_def text;
BEGIN
  FOR legacy_name, legacy_def IN
    SELECT con.conname, pg_get_constraintdef(con.oid)
    FROM pg_constraint con
    WHERE con.conrelid = 'public.refund_requests'::regclass
      AND con.contype = 'c'
  LOOP
    IF legacy_def LIKE '%submitted%'
       AND legacy_def LIKE '%withdrawn%'
       AND legacy_def NOT LIKE '%refunded%'
       AND legacy_def NOT LIKE '%processing_state%'
    THEN
      EXECUTE format('ALTER TABLE public.refund_requests DROP CONSTRAINT %I', legacy_name);
    ELSIF legacy_def LIKE '%provider_refund_status%'
       AND legacy_def LIKE '%not_sent%'
       AND legacy_def NOT LIKE '%completed%'
       AND legacy_def NOT LIKE '%processing_state%'
    THEN
      EXECUTE format('ALTER TABLE public.refund_requests DROP CONSTRAINT %I', legacy_name);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.refund_requests
  ADD CONSTRAINT refund_requests_status_check
    CHECK (status IN ('submitted', 'in_review', 'approved', 'processing', 'refunded', 'rejected', 'withdrawn')),
  ADD CONSTRAINT refund_requests_provider_refund_status_check
    CHECK (provider_refund_status IN ('not_sent', 'processing', 'completed', 'failed')),
  ADD CONSTRAINT refund_requests_financial_effect_false_check
    CHECK (financial_effect = false),
  ADD CONSTRAINT refund_requests_processing_error_class_check
    CHECK (
      processing_error_class IS NULL
      OR processing_error_class IN ('temporary', 'permanent', 'timeout')
    ),
  ADD CONSTRAINT refund_requests_provider_refund_id_format_check
    CHECK (
      provider_refund_id IS NULL
      OR provider_refund_id ~ '^sandbox_[a-f0-9]{32}$'
    );

ALTER TABLE public.refund_requests
  ADD CONSTRAINT refund_requests_processing_shape_check
    CHECK (
      (
        processing_state IS NULL
        AND idempotency_key IS NULL
        AND processing_started_at IS NULL
        AND processing_finished_at IS NULL
        AND processing_attempts = 0
        AND last_processing_error IS NULL
        AND processing_error_class IS NULL
        AND provider_refund_id IS NULL
        AND provider_refund_status = 'not_sent'
        AND status NOT IN ('processing', 'refunded')
      )
      OR (
        processing_state = 'processing'
        AND idempotency_key IS NOT NULL
        AND processing_started_at IS NOT NULL
        AND processing_finished_at IS NULL
        AND processing_attempts >= 1
        AND processing_error_class IS NULL
        AND provider_refund_id IS NULL
        AND (
          (status = 'approved' AND provider_refund_status = 'not_sent')
          OR (status = 'processing' AND provider_refund_status = 'processing')
        )
      )
      OR (
        processing_state = 'simulated'
        AND status = 'approved'
        AND provider_refund_status = 'not_sent'
        AND provider_refund_id IS NULL
        AND processing_error_class IS NULL
        AND last_processing_error IS NULL
        AND idempotency_key IS NOT NULL
        AND processing_started_at IS NOT NULL
        AND processing_finished_at IS NOT NULL
        AND processing_attempts >= 1
      )
      OR (
        processing_state = 'failed'
        AND provider_refund_id IS NULL
        AND processing_finished_at IS NULL
        AND idempotency_key IS NOT NULL
        AND processing_started_at IS NOT NULL
        AND processing_attempts >= 1
        AND (
          (
            status = 'approved'
            AND provider_refund_status = 'not_sent'
            AND processing_error_class IS NULL
            AND last_processing_error IS NOT NULL
          )
          OR (
            status = 'processing'
            AND provider_refund_status = 'failed'
            AND processing_error_class IN ('temporary', 'permanent')
            AND last_processing_error IS NOT NULL
          )
        )
      )
      OR (
        processing_state = 'unknown'
        AND status = 'processing'
        AND provider_refund_status = 'processing'
        AND provider_refund_id IS NULL
        AND processing_error_class = 'timeout'
        AND last_processing_error IS NOT NULL
        AND processing_finished_at IS NULL
        AND idempotency_key IS NOT NULL
        AND processing_started_at IS NOT NULL
        AND processing_attempts >= 1
      )
      OR (
        processing_state = 'completed'
        AND status = 'refunded'
        AND provider_refund_status = 'completed'
        AND provider_refund_id IS NOT NULL
        AND processing_error_class IS NULL
        AND last_processing_error IS NULL
        AND processing_finished_at IS NOT NULL
        AND idempotency_key IS NOT NULL
        AND processing_started_at IS NOT NULL
        AND processing_attempts >= 1
      )
    );

ALTER TABLE public.refund_requests
  ADD CONSTRAINT refund_requests_processing_terminal_check
    CHECK (
      (processing_state IS DISTINCT FROM 'simulated' OR processing_finished_at IS NOT NULL)
      AND (processing_state IS DISTINCT FROM 'processing' OR processing_finished_at IS NULL)
      AND (processing_state IS DISTINCT FROM 'failed' OR processing_finished_at IS NULL)
      AND (processing_state IS DISTINCT FROM 'unknown' OR processing_finished_at IS NULL)
      AND (processing_state IS DISTINCT FROM 'completed' OR processing_finished_at IS NOT NULL)
    );

CREATE UNIQUE INDEX IF NOT EXISTS refund_requests_provider_refund_id_uidx
  ON public.refund_requests (provider_refund_id)
  WHERE provider_refund_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.protect_sandbox_refund_settlement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF OLD.idempotency_key IS NOT NULL AND NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
    RAISE EXCEPTION 'idempotency_key_immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'refunded' AND NEW.status IS DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'refunded_status_immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.provider_refund_status = 'completed' AND NEW.provider_refund_status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'provider_refund_status_immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.provider_refund_id IS NOT NULL AND NEW.provider_refund_id IS DISTINCT FROM OLD.provider_refund_id THEN
    RAISE EXCEPTION 'provider_refund_id_immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.financial_effect IS TRUE THEN
    RAISE EXCEPTION 'financial_effect_forbidden' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refund_requests_protect_sandbox_settlement ON public.refund_requests;
CREATE TRIGGER refund_requests_protect_sandbox_settlement
  BEFORE UPDATE ON public.refund_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_sandbox_refund_settlement();

CREATE OR REPLACE FUNCTION public.dispatch_sandbox_refund(
  p_refund_request_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_row public.refund_requests%ROWTYPE;
  v_session public.checkout_sessions%ROWTYPE;
BEGIN
  SET LOCAL statement_timeout = '5s';
  IF p_refund_request_id IS NULL OR p_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found', 'financial_effect', false);
  END IF;

  SELECT * INTO v_row FROM public.refund_requests WHERE id = p_refund_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found', 'financial_effect', false);
  END IF;
  IF v_row.idempotency_key IS DISTINCT FROM 'mercadopago:refund:' || v_row.id::text
     OR v_row.processing_state IS DISTINCT FROM 'processing'
     OR v_row.provider <> 'mercadopago'
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_approved', 'financial_effect', false, 'status', v_row.status);
  END IF;

  SELECT * INTO v_session FROM public.checkout_sessions WHERE mp_payment_id = v_row.mp_payment_id LIMIT 1;
  IF v_session.id IS NULL OR v_session.onboarding_user_id IS DISTINCT FROM p_actor_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_owner', 'financial_effect', false, 'status', v_row.status);
  END IF;
  IF v_session.transaction_amount IS NULL OR v_session.transaction_paid_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'paid_amount_unavailable', 'financial_effect', false, 'status', v_row.status);
  END IF;
  IF v_session.transaction_currency IS DISTINCT FROM 'BRL' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_currency', 'financial_effect', false, 'status', v_row.status);
  END IF;

  UPDATE public.refund_requests
  SET status = 'processing', provider_refund_status = 'processing', financial_effect = false
  WHERE id = v_row.id
    AND status = 'approved'
    AND provider_refund_status = 'not_sent'
    AND processing_state = 'processing'
    AND provider_refund_id IS NULL
    AND processing_finished_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'processing_in_progress',
      'financial_effect', false,
      'idempotency_key', 'mercadopago:refund:' || p_refund_request_id::text
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'financial_effect', false,
    'status', v_row.status,
    'provider_refund_status', v_row.provider_refund_status,
    'provider_refund_id', NULL,
    'idempotency_key', v_row.idempotency_key,
    'processing_state', v_row.processing_state,
    'processing_attempts', v_row.processing_attempts,
    'processing_finished_at', NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_sandbox_refund(
  p_refund_request_id uuid,
  p_actor_user_id uuid,
  p_provider_refund_id text,
  p_amount numeric,
  p_currency text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_row public.refund_requests%ROWTYPE;
  v_session public.checkout_sessions%ROWTYPE;
BEGIN
  SET LOCAL statement_timeout = '5s';
  SELECT * INTO v_row FROM public.refund_requests WHERE id = p_refund_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found', 'financial_effect', false);
  END IF;

  SELECT * INTO v_session FROM public.checkout_sessions WHERE mp_payment_id = v_row.mp_payment_id LIMIT 1;
  IF v_session.id IS NULL OR v_session.onboarding_user_id IS DISTINCT FROM p_actor_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_owner', 'financial_effect', false);
  END IF;

  IF v_row.status = 'refunded' AND v_row.provider_refund_id = p_provider_refund_id THEN
    IF p_currency IS DISTINCT FROM 'BRL'
       OR v_session.transaction_currency IS DISTINCT FROM 'BRL'
       OR p_amount IS DISTINCT FROM v_session.transaction_amount
    THEN
      RETURN jsonb_build_object('ok', false, 'error', 'snapshot_amount_mismatch', 'financial_effect', false, 'status', v_row.status);
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'replay', true,
      'financial_effect', false,
      'status', 'refunded',
      'provider_refund_status', 'completed',
      'provider_refund_id', v_row.provider_refund_id,
      'idempotency_key', v_row.idempotency_key,
      'processing_attempts', v_row.processing_attempts,
      'processing_finished_at', v_row.processing_finished_at
    );
  END IF;

  IF v_row.status = 'refunded' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_refunded', 'financial_effect', false, 'status', 'refunded');
  END IF;
  IF v_session.transaction_amount IS NULL OR v_session.transaction_paid_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'paid_amount_unavailable', 'financial_effect', false, 'status', v_row.status);
  END IF;
  IF p_currency IS DISTINCT FROM 'BRL' OR v_session.transaction_currency IS DISTINCT FROM 'BRL' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_currency', 'financial_effect', false, 'status', v_row.status);
  END IF;
  IF p_amount IS DISTINCT FROM v_session.transaction_amount OR p_amount IS NULL OR p_amount <> trunc(p_amount, 2) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'snapshot_amount_mismatch', 'financial_effect', false, 'status', v_row.status);
  END IF;
  IF p_provider_refund_id IS NULL OR p_provider_refund_id !~ '^sandbox_[a-f0-9]{32}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'untrusted_provider_refund_id', 'financial_effect', false, 'status', v_row.status);
  END IF;

  UPDATE public.refund_requests
  SET
    status = 'refunded',
    provider_refund_status = 'completed',
    provider_refund_id = p_provider_refund_id,
    processing_state = 'completed',
    processing_finished_at = now(),
    processing_error_class = NULL,
    last_processing_error = NULL,
    financial_effect = false
  WHERE id = v_row.id
    AND status = 'processing'
    AND provider_refund_status = 'processing'
    AND processing_state = 'processing'
    AND idempotency_key = 'mercadopago:refund:' || id::text
    AND provider_refund_id IS NULL
    AND processing_finished_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'claim_not_processing', 'financial_effect', false);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'replay', false,
    'financial_effect', false,
    'status', v_row.status,
    'provider_refund_status', v_row.provider_refund_status,
    'provider_refund_id', v_row.provider_refund_id,
    'idempotency_key', v_row.idempotency_key,
    'processing_state', v_row.processing_state,
    'processing_attempts', v_row.processing_attempts,
    'processing_finished_at', v_row.processing_finished_at
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'duplicate_provider_refund', 'financial_effect', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_sandbox_refund(
  p_refund_request_id uuid,
  p_actor_user_id uuid,
  p_error text,
  p_error_class text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_row public.refund_requests%ROWTYPE;
  v_session public.checkout_sessions%ROWTYPE;
  v_error text;
BEGIN
  SET LOCAL statement_timeout = '5s';
  IF p_error_class NOT IN ('temporary', 'permanent') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_error_class', 'financial_effect', false);
  END IF;
  v_error := left(COALESCE(p_error, 'provider_error'), 200);
  IF v_error ~* 'access_token|client_secret|authorization|cookie|bearer ' THEN
    v_error := 'redacted';
  END IF;

  SELECT * INTO v_row FROM public.refund_requests WHERE id = p_refund_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found', 'financial_effect', false);
  END IF;
  SELECT * INTO v_session FROM public.checkout_sessions WHERE mp_payment_id = v_row.mp_payment_id LIMIT 1;
  IF v_session.id IS NULL OR v_session.onboarding_user_id IS DISTINCT FROM p_actor_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_owner', 'financial_effect', false);
  END IF;

  UPDATE public.refund_requests
  SET
    processing_state = 'failed',
    provider_refund_status = 'failed',
    processing_error_class = p_error_class,
    last_processing_error = v_error,
    financial_effect = false
  WHERE id = v_row.id
    AND status = 'processing'
    AND provider_refund_status = 'processing'
    AND processing_state = 'processing'
    AND provider_refund_id IS NULL
    AND processing_finished_at IS NULL
    AND idempotency_key = 'mercadopago:refund:' || id::text
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'claim_not_processing', 'financial_effect', false);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'financial_effect', false,
    'status', v_row.status,
    'provider_refund_status', v_row.provider_refund_status,
    'provider_refund_id', NULL,
    'idempotency_key', v_row.idempotency_key,
    'processing_state', v_row.processing_state,
    'processing_error_class', v_row.processing_error_class,
    'processing_attempts', v_row.processing_attempts,
    'retryable', p_error_class = 'temporary',
    'processing_finished_at', NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.timeout_sandbox_refund(
  p_refund_request_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_row public.refund_requests%ROWTYPE;
  v_session public.checkout_sessions%ROWTYPE;
BEGIN
  SET LOCAL statement_timeout = '5s';
  SELECT * INTO v_row FROM public.refund_requests WHERE id = p_refund_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found', 'financial_effect', false);
  END IF;
  SELECT * INTO v_session FROM public.checkout_sessions WHERE mp_payment_id = v_row.mp_payment_id LIMIT 1;
  IF v_session.id IS NULL OR v_session.onboarding_user_id IS DISTINCT FROM p_actor_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_owner', 'financial_effect', false);
  END IF;

  UPDATE public.refund_requests
  SET
    processing_state = 'unknown',
    processing_error_class = 'timeout',
    last_processing_error = 'provider_timeout',
    financial_effect = false
  WHERE id = v_row.id
    AND status = 'processing'
    AND provider_refund_status = 'processing'
    AND processing_state = 'processing'
    AND provider_refund_id IS NULL
    AND processing_finished_at IS NULL
    AND idempotency_key = 'mercadopago:refund:' || id::text
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'claim_not_processing', 'financial_effect', false);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'financial_effect', false,
    'status', v_row.status,
    'provider_refund_status', v_row.provider_refund_status,
    'provider_refund_id', NULL,
    'idempotency_key', v_row.idempotency_key,
    'processing_state', 'unknown',
    'processing_error_class', 'timeout',
    'processing_attempts', v_row.processing_attempts,
    'retryable', true,
    'processing_finished_at', NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_sandbox_refund(
  p_refund_request_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_row public.refund_requests%ROWTYPE;
  v_session public.checkout_sessions%ROWTYPE;
  v_key text;
BEGIN
  SET LOCAL statement_timeout = '5s';
  SELECT * INTO v_row FROM public.refund_requests WHERE id = p_refund_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found', 'financial_effect', false);
  END IF;
  v_key := v_row.idempotency_key;
  IF v_row.status = 'refunded' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_refunded', 'financial_effect', false, 'idempotency_key', v_key);
  END IF;
  IF v_row.processing_error_class = 'permanent' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'not_retryable',
      'financial_effect', false,
      'idempotency_key', v_key,
      'processing_attempts', v_row.processing_attempts,
      'status', v_row.status
    );
  END IF;
  IF v_row.processing_attempts >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'retry_exhausted', 'financial_effect', false, 'idempotency_key', v_key, 'processing_attempts', v_row.processing_attempts);
  END IF;
  IF NOT (
    (v_row.processing_state = 'failed' AND v_row.processing_error_class = 'temporary')
    OR (v_row.processing_state = 'unknown' AND v_row.processing_error_class = 'timeout')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'processing_in_progress', 'financial_effect', false, 'idempotency_key', v_key);
  END IF;

  SELECT * INTO v_session FROM public.checkout_sessions WHERE mp_payment_id = v_row.mp_payment_id LIMIT 1;
  IF v_session.id IS NULL OR v_session.onboarding_user_id IS DISTINCT FROM p_actor_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_owner', 'financial_effect', false);
  END IF;
  IF v_session.transaction_currency IS DISTINCT FROM 'BRL' OR v_session.transaction_amount IS NULL OR v_session.transaction_paid_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'paid_amount_unavailable', 'financial_effect', false);
  END IF;

  UPDATE public.refund_requests
  SET
    processing_attempts = processing_attempts + 1,
    processing_state = 'processing',
    provider_refund_status = 'processing',
    status = 'processing',
    processing_error_class = NULL,
    last_processing_error = NULL,
    processing_finished_at = NULL,
    financial_effect = false
  WHERE id = v_row.id
    AND idempotency_key = v_key
    AND idempotency_key = 'mercadopago:refund:' || id::text
    AND provider_refund_id IS NULL
    AND (
      (processing_state = 'failed' AND processing_error_class = 'temporary')
      OR (processing_state = 'unknown' AND processing_error_class = 'timeout')
    )
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'processing_in_progress', 'financial_effect', false, 'idempotency_key', v_key);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', 'retried',
    'financial_effect', false,
    'status', v_row.status,
    'provider_refund_status', v_row.provider_refund_status,
    'idempotency_key', v_row.idempotency_key,
    'processing_state', v_row.processing_state,
    'processing_attempts', v_row.processing_attempts,
    'provider_refund_id', NULL
  );
END;
$$;

COMMENT ON FUNCTION public.dispatch_sandbox_refund(uuid, uuid) IS
  'Moves an existing dry-run claim to sandbox processing. Does not call a provider.';
COMMENT ON FUNCTION public.complete_sandbox_refund(uuid, uuid, text, numeric, text) IS
  'Records one sandbox confirmation. financial_effect stays false and the idempotency key is unchanged.';
COMMENT ON FUNCTION public.fail_sandbox_refund(uuid, uuid, text, text) IS
  'Persists a known sandbox failure. Does not mark the request refunded.';
COMMENT ON FUNCTION public.timeout_sandbox_refund(uuid, uuid) IS
  'Persists an unknown sandbox outcome. Does not mark the request refunded or failed.';
COMMENT ON FUNCTION public.retry_sandbox_refund(uuid, uuid) IS
  'Reopens a temporary failure or a timeout with the same idempotency key.';

REVOKE ALL ON FUNCTION public.dispatch_sandbox_refund(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_sandbox_refund(uuid, uuid, text, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_sandbox_refund(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.timeout_sandbox_refund(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_sandbox_refund(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_sandbox_refund_settlement() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.dispatch_sandbox_refund(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_sandbox_refund(uuid, uuid, text, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_sandbox_refund(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.timeout_sandbox_refund(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_sandbox_refund(uuid, uuid) TO service_role;

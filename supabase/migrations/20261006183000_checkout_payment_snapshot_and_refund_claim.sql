-- Local-only foundation for a future Mercado Pago refund.
-- Stores the confirmed payment snapshot and a persistent refund claim.
-- Does not call Mercado Pago, does not mark a refund as sent, and must not
-- be applied to the remote database from this phase.

ALTER TABLE public.checkout_sessions
  ADD COLUMN IF NOT EXISTS transaction_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS transaction_currency text,
  ADD COLUMN IF NOT EXISTS transaction_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS transaction_snapshot_conflict text,
  ADD COLUMN IF NOT EXISTS transaction_snapshot_conflict_at timestamptz;

COMMENT ON COLUMN public.checkout_sessions.transaction_amount IS
  'Immutable amount confirmed by the payment provider. Never backfilled from plans.amount or contracted_amount.';
COMMENT ON COLUMN public.checkout_sessions.transaction_currency IS
  'Immutable currency confirmed with transaction_amount.';
COMMENT ON COLUMN public.checkout_sessions.transaction_paid_at IS
  'Provider confirmation timestamp captured with the amount snapshot.';
COMMENT ON COLUMN public.checkout_sessions.transaction_snapshot_conflict IS
  'Set when a later confirmation disagrees. The historical snapshot stays unchanged.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checkout_sessions_transaction_snapshot_complete_check'
      AND conrelid = 'public.checkout_sessions'::regclass
  ) THEN
    ALTER TABLE public.checkout_sessions
      ADD CONSTRAINT checkout_sessions_transaction_snapshot_complete_check
      CHECK (
        (
          transaction_amount IS NULL
          AND transaction_currency IS NULL
          AND transaction_paid_at IS NULL
        )
        OR (
          transaction_amount IS NOT NULL
          AND transaction_currency IS NOT NULL
          AND transaction_paid_at IS NOT NULL
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checkout_sessions_transaction_amount_positive_check'
      AND conrelid = 'public.checkout_sessions'::regclass
  ) THEN
    ALTER TABLE public.checkout_sessions
      ADD CONSTRAINT checkout_sessions_transaction_amount_positive_check
      CHECK (transaction_amount IS NULL OR transaction_amount > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checkout_sessions_transaction_currency_check'
      AND conrelid = 'public.checkout_sessions'::regclass
  ) THEN
    ALTER TABLE public.checkout_sessions
      ADD CONSTRAINT checkout_sessions_transaction_currency_check
      CHECK (transaction_currency IS NULL OR transaction_currency ~ '^[A-Z]{3}$');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checkout_sessions_transaction_snapshot_conflict_check'
      AND conrelid = 'public.checkout_sessions'::regclass
  ) THEN
    ALTER TABLE public.checkout_sessions
      ADD CONSTRAINT checkout_sessions_transaction_snapshot_conflict_check
      CHECK (
        transaction_snapshot_conflict IS NULL
        OR transaction_snapshot_conflict IN ('amount', 'currency', 'amount_and_currency')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS checkout_sessions_snapshot_conflict_idx
  ON public.checkout_sessions (transaction_snapshot_conflict_at)
  WHERE transaction_snapshot_conflict IS NOT NULL;

CREATE OR REPLACE FUNCTION public.protect_checkout_transaction_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF OLD.transaction_amount IS NOT NULL
     AND (
       NEW.transaction_amount IS DISTINCT FROM OLD.transaction_amount
       OR NEW.transaction_currency IS DISTINCT FROM OLD.transaction_currency
       OR NEW.transaction_paid_at IS DISTINCT FROM OLD.transaction_paid_at
     )
  THEN
    RAISE EXCEPTION 'transaction_snapshot_immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS checkout_sessions_protect_transaction_snapshot ON public.checkout_sessions;
CREATE TRIGGER checkout_sessions_protect_transaction_snapshot
  BEFORE UPDATE ON public.checkout_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_checkout_transaction_snapshot();

CREATE OR REPLACE FUNCTION public.record_checkout_payment_snapshot(
  p_client_mutation_id uuid,
  p_payment_id text,
  p_payment_status text,
  p_preference_id text,
  p_transaction_amount numeric,
  p_transaction_currency text,
  p_transaction_paid_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_session public.checkout_sessions%ROWTYPE;
  v_amount numeric(12,2);
  v_currency text;
  v_snapshot_ready boolean;
  v_conflict text;
BEGIN
  IF p_client_mutation_id IS NULL OR p_payment_id IS NULL OR btrim(p_payment_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_id_required');
  END IF;

  SELECT *
  INTO v_session
  FROM public.checkout_sessions
  WHERE client_mutation_id = p_client_mutation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'checkout_session_not_found');
  END IF;

  IF v_session.mp_payment_id IS NOT NULL AND v_session.mp_payment_id <> btrim(p_payment_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'checkout_session_payment_conflict');
  END IF;

  v_currency := NULLIF(upper(btrim(COALESCE(p_transaction_currency, ''))), '');
  v_snapshot_ready :=
    p_transaction_amount IS NOT NULL
    AND p_transaction_amount > 0
    AND p_transaction_amount = trunc(p_transaction_amount, 2)
    AND p_transaction_amount < 10000000000
    AND v_currency IS NOT NULL
    AND v_currency ~ '^[A-Z]{3}$'
    AND p_transaction_paid_at IS NOT NULL;

  IF v_snapshot_ready THEN
    v_amount := p_transaction_amount::numeric(12,2);
  ELSE
    v_amount := NULL;
    v_currency := NULL;
  END IF;

  IF v_session.mp_payment_id IS NULL THEN
    UPDATE public.checkout_sessions
    SET
      mp_payment_id = btrim(p_payment_id),
      mp_payment_status = p_payment_status,
      mp_preference_id = p_preference_id,
      mp_payment_paid_at = now(),
      transaction_amount = v_amount,
      transaction_currency = CASE WHEN v_snapshot_ready THEN v_currency ELSE NULL END,
      transaction_paid_at = CASE WHEN v_snapshot_ready THEN p_transaction_paid_at ELSE NULL END
    WHERE id = v_session.id
      AND mp_payment_id IS NULL
    RETURNING * INTO v_session;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'checkout_session_payment_update_failed');
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'replay', false,
      'snapshot_conflict', NULL,
      'snapshot_stored', v_session.transaction_amount IS NOT NULL
    );
  END IF;

  -- A payment linked before this snapshot existed stays without one.
  IF v_session.transaction_amount IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'replay', true,
      'snapshot_conflict', NULL,
      'snapshot_stored', false
    );
  END IF;

  IF NOT v_snapshot_ready
     OR (v_session.transaction_amount = v_amount AND v_session.transaction_currency = v_currency)
  THEN
    RETURN jsonb_build_object(
      'ok', true,
      'replay', true,
      'snapshot_conflict', NULL,
      'snapshot_stored', true
    );
  END IF;

  v_conflict := CASE
    WHEN v_session.transaction_amount IS DISTINCT FROM v_amount
     AND v_session.transaction_currency IS DISTINCT FROM v_currency THEN 'amount_and_currency'
    WHEN v_session.transaction_amount IS DISTINCT FROM v_amount THEN 'amount'
    ELSE 'currency'
  END;

  UPDATE public.checkout_sessions
  SET
    transaction_snapshot_conflict = v_conflict,
    transaction_snapshot_conflict_at = now()
  WHERE id = v_session.id
    AND transaction_amount IS NOT DISTINCT FROM v_session.transaction_amount
    AND transaction_currency IS NOT DISTINCT FROM v_session.transaction_currency
    AND transaction_paid_at IS NOT DISTINCT FROM v_session.transaction_paid_at;

  RETURN jsonb_build_object(
    'ok', true,
    'replay', true,
    'snapshot_conflict', v_conflict,
    'snapshot_stored', true
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'checkout_session_payment_conflict');
END;
$$;

COMMENT ON FUNCTION public.record_checkout_payment_snapshot(uuid, text, text, text, numeric, text, timestamptz) IS
  'Links a Checkout Pro payment and stores its confirmed amount once. A different later amount or currency is recorded as a conflict and does not overwrite the snapshot.';

REVOKE ALL ON FUNCTION public.record_checkout_payment_snapshot(uuid, text, text, text, numeric, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_checkout_payment_snapshot(uuid, text, text, text, numeric, text, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.record_checkout_payment_snapshot(uuid, text, text, text, numeric, text, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_checkout_payment_snapshot(uuid, text, text, text, numeric, text, timestamptz) TO service_role;

ALTER TABLE public.refund_requests
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_processing_error text,
  ADD COLUMN IF NOT EXISTS processing_state text;

COMMENT ON COLUMN public.refund_requests.idempotency_key IS
  'Deterministic processing key mercadopago:refund:<id>. Assigned by claim_refund_processing, never by the browser.';
COMMENT ON COLUMN public.refund_requests.processing_state IS
  'Persistent claim: processing, simulated, or failed. simulated is not a completed provider refund.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'refund_requests_processing_attempts_check'
      AND conrelid = 'public.refund_requests'::regclass
  ) THEN
    ALTER TABLE public.refund_requests
      ADD CONSTRAINT refund_requests_processing_attempts_check
      CHECK (processing_attempts >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'refund_requests_processing_error_length_check'
      AND conrelid = 'public.refund_requests'::regclass
  ) THEN
    ALTER TABLE public.refund_requests
      ADD CONSTRAINT refund_requests_processing_error_length_check
      CHECK (last_processing_error IS NULL OR char_length(last_processing_error) <= 200);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'refund_requests_idempotency_key_check'
      AND conrelid = 'public.refund_requests'::regclass
  ) THEN
    ALTER TABLE public.refund_requests
      ADD CONSTRAINT refund_requests_idempotency_key_check
      CHECK (
        idempotency_key IS NULL
        OR idempotency_key = 'mercadopago:refund:' || id::text
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'refund_requests_processing_shape_check'
      AND conrelid = 'public.refund_requests'::regclass
  ) THEN
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
        )
        OR (
          processing_state IN ('processing', 'simulated', 'failed')
          AND idempotency_key IS NOT NULL
          AND processing_started_at IS NOT NULL
          AND processing_attempts >= 1
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'refund_requests_processing_terminal_check'
      AND conrelid = 'public.refund_requests'::regclass
  ) THEN
    ALTER TABLE public.refund_requests
      ADD CONSTRAINT refund_requests_processing_terminal_check
      CHECK (
        (processing_state IS DISTINCT FROM 'simulated' OR processing_finished_at IS NOT NULL)
        AND (processing_state IS DISTINCT FROM 'processing' OR processing_finished_at IS NULL)
        AND (processing_state IS DISTINCT FROM 'failed' OR processing_finished_at IS NULL)
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS refund_requests_idempotency_key_uidx
  ON public.refund_requests (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS refund_requests_payment_processing_uidx
  ON public.refund_requests (mp_payment_id)
  WHERE processing_state IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_refund_processing(
  p_refund_request_id uuid,
  p_retry boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_row public.refund_requests%ROWTYPE;
  v_key text;
BEGIN
  IF p_refund_request_id IS NULL THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'not_found');
  END IF;

  SELECT *
  INTO v_row
  FROM public.refund_requests
  WHERE id = p_refund_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'not_found');
  END IF;

  v_key := 'mercadopago:refund:' || v_row.id::text;

  IF v_row.status <> 'approved'
     OR v_row.provider <> 'mercadopago'
     OR v_row.provider_refund_status <> 'not_sent'
  THEN
    RETURN jsonb_build_object(
      'acquired', false,
      'reason', 'not_approved',
      'idempotency_key', NULL,
      'processing_state', v_row.processing_state,
      'processing_attempts', v_row.processing_attempts,
      'provider_refund_status', v_row.provider_refund_status
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.refund_requests AS other
    WHERE other.mp_payment_id = v_row.mp_payment_id
      AND other.id <> v_row.id
      AND other.processing_state IS NOT NULL
  ) THEN
    RETURN jsonb_build_object(
      'acquired', false,
      'reason', 'duplicate_payment',
      'idempotency_key', v_key,
      'processing_state', v_row.processing_state,
      'processing_attempts', v_row.processing_attempts,
      'provider_refund_status', 'not_sent'
    );
  END IF;

  IF v_row.processing_state = 'processing' THEN
    RETURN jsonb_build_object(
      'acquired', false,
      'reason', 'in_progress',
      'idempotency_key', v_row.idempotency_key,
      'processing_state', v_row.processing_state,
      'processing_attempts', v_row.processing_attempts,
      'provider_refund_status', 'not_sent'
    );
  END IF;

  IF v_row.processing_state = 'simulated' THEN
    RETURN jsonb_build_object(
      'acquired', false,
      'reason', 'completed',
      'idempotency_key', v_row.idempotency_key,
      'processing_state', v_row.processing_state,
      'processing_attempts', v_row.processing_attempts,
      'provider_refund_status', 'not_sent'
    );
  END IF;

  IF v_row.processing_state = 'failed' AND COALESCE(p_retry, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'acquired', false,
      'reason', 'retry_required',
      'idempotency_key', v_row.idempotency_key,
      'processing_state', v_row.processing_state,
      'processing_attempts', v_row.processing_attempts,
      'provider_refund_status', 'not_sent'
    );
  END IF;

  IF v_row.processing_state IS NULL OR v_row.processing_state = 'failed' THEN
    UPDATE public.refund_requests
    SET
      idempotency_key = v_key,
      processing_state = 'processing',
      processing_started_at = COALESCE(processing_started_at, now()),
      processing_attempts = processing_attempts + 1,
      last_processing_error = NULL
    WHERE id = v_row.id
      AND provider_refund_status = 'not_sent'
      AND (
        processing_state IS NULL
        OR (processing_state = 'failed' AND COALESCE(p_retry, false))
      )
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'acquired', false,
        'reason', 'in_progress',
        'idempotency_key', v_key,
        'provider_refund_status', 'not_sent'
      );
    END IF;

    RETURN jsonb_build_object(
      'acquired', true,
      'reason', CASE WHEN v_row.processing_attempts = 1 THEN 'claimed' ELSE 'retried' END,
      'idempotency_key', v_row.idempotency_key,
      'processing_state', v_row.processing_state,
      'processing_attempts', v_row.processing_attempts,
      'provider_refund_status', v_row.provider_refund_status
    );
  END IF;

  RETURN jsonb_build_object(
    'acquired', false,
    'reason', 'completed',
    'idempotency_key', v_row.idempotency_key,
    'provider_refund_status', 'not_sent'
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'acquired', false,
      'reason', 'duplicate_payment',
      'idempotency_key', v_key,
      'provider_refund_status', 'not_sent'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_refund_processing_dry_run(
  p_refund_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_row public.refund_requests%ROWTYPE;
BEGIN
  UPDATE public.refund_requests
  SET
    processing_state = 'simulated',
    processing_finished_at = now(),
    last_processing_error = NULL
  WHERE id = p_refund_request_id
    AND processing_state = 'processing'
    AND provider_refund_status = 'not_sent'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'claim_not_processing');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'processing_simulated',
    'financial_effect', false,
    'provider_refund_id', NULL,
    'provider_refund_status', v_row.provider_refund_status,
    'idempotency_key', v_row.idempotency_key,
    'processing_attempts', v_row.processing_attempts
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_refund_processing(
  p_refund_request_id uuid,
  p_error text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_row public.refund_requests%ROWTYPE;
  v_error text;
BEGIN
  v_error := left(COALESCE(p_error, 'provider_error'), 200);
  IF v_error ~* 'access_token|client_secret|authorization|cookie|bearer ' THEN
    v_error := 'redacted';
  END IF;

  UPDATE public.refund_requests
  SET
    processing_state = 'failed',
    last_processing_error = v_error
  WHERE id = p_refund_request_id
    AND processing_state = 'processing'
    AND provider_refund_status = 'not_sent'
    AND processing_finished_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'claim_not_processing');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'failed',
    'financial_effect', false,
    'provider_refund_id', NULL,
    'provider_refund_status', v_row.provider_refund_status,
    'idempotency_key', v_row.idempotency_key,
    'processing_attempts', v_row.processing_attempts
  );
END;
$$;

COMMENT ON FUNCTION public.claim_refund_processing(uuid, boolean) IS
  'Single persistent claim for one refund request. Does not send a provider refund.';
COMMENT ON FUNCTION public.complete_refund_processing_dry_run(uuid) IS
  'Marks a dry-run claim simulated. provider_refund_status stays not_sent and no provider refund id is stored.';

REVOKE ALL ON FUNCTION public.claim_refund_processing(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_refund_processing(uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.claim_refund_processing(uuid, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_refund_processing(uuid, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.complete_refund_processing_dry_run(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_refund_processing_dry_run(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.complete_refund_processing_dry_run(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_refund_processing_dry_run(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.fail_refund_processing(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_refund_processing(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.fail_refund_processing(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fail_refund_processing(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.protect_checkout_transaction_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_checkout_transaction_snapshot() FROM anon;
REVOKE ALL ON FUNCTION public.protect_checkout_transaction_snapshot() FROM authenticated;

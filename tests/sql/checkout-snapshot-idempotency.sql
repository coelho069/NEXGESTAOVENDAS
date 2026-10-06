-- Local assertions for the payment snapshot and the persistent refund claim.
-- The surrounding shell cleans these fixed ids and restores the migration.

DO $$
DECLARE
  v_plan uuid;
  v_snapshot uuid := '58321000-0000-4000-8000-000000000010';
  v_snapshot_mutation uuid := '58321000-0000-4000-8000-000000000011';
  v_legacy uuid := '58321000-0000-4000-8000-000000000012';
  v_legacy_mutation uuid := '58321000-0000-4000-8000-000000000013';
  v_currency uuid := '58321000-0000-4000-8000-000000000014';
  v_currency_mutation uuid := '58321000-0000-4000-8000-000000000015';
  v_race_checkout uuid := '58321000-0000-4000-8000-0000000000b1';
  v_race_mutation uuid := '58321000-0000-4000-8000-0000000000b2';
  v_restart uuid := '58321000-0000-4000-8000-0000000000a1';
  v_retry uuid := '58321000-0000-4000-8000-0000000000a2';
  v_blocked uuid := '58321000-0000-4000-8000-0000000000a3';
  v_duplicate uuid := '58321000-0000-4000-8000-0000000000a4';
  v_race_refund uuid := '58321000-0000-4000-8000-0000000000a5';
  v_result jsonb;
  v_amount numeric;
  v_currency_code text;
  v_paid timestamptz;
  v_paid_again timestamptz;
  v_conflict text;
  v_attempts integer;
  v_key text;
  v_state text;
  v_status text;
  v_provider_status text;
  v_error text;
  v_index_count integer;
  v_constraint_count integer;
BEGIN
  SELECT id INTO v_plan FROM public.plans LIMIT 1;
  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'local_plan_missing';
  END IF;

  DELETE FROM public.refund_requests
  WHERE id IN (v_restart, v_retry, v_blocked, v_duplicate, v_race_refund);
  DELETE FROM public.checkout_sessions
  WHERE id IN (v_snapshot, v_legacy, v_currency, v_race_checkout);

  IF (
    SELECT count(*) FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'checkout_sessions_snapshot_conflict_idx',
        'refund_requests_idempotency_key_uidx',
        'refund_requests_payment_processing_uidx'
      )
  ) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'snapshot_indexes_missing';
  END IF;

  SELECT count(*) INTO v_constraint_count
  FROM pg_constraint
  WHERE conname IN (
    'checkout_sessions_transaction_snapshot_complete_check',
    'checkout_sessions_transaction_amount_positive_check',
    'checkout_sessions_transaction_currency_check',
    'checkout_sessions_transaction_snapshot_conflict_check',
    'refund_requests_processing_shape_check',
    'refund_requests_processing_terminal_check',
    'refund_requests_idempotency_key_check'
  );
  IF v_constraint_count IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'snapshot_constraints_missing: %', v_constraint_count;
  END IF;

  INSERT INTO public.checkout_sessions (id, client_mutation_id, plan_id, payer_email)
  VALUES
    (v_snapshot, v_snapshot_mutation, v_plan, 'snapshot-phase-58321@gmail.com'),
    (v_currency, v_currency_mutation, v_plan, 'snapshot-phase-58321@gmail.com'),
    (v_race_checkout, v_race_mutation, v_plan, 'snapshot-phase-58321@gmail.com');

  INSERT INTO public.checkout_sessions (
    id, client_mutation_id, plan_id, payer_email, mp_payment_id, mp_payment_status, mp_payment_paid_at
  ) VALUES (
    v_legacy, v_legacy_mutation, v_plan, 'snapshot-phase-58321@gmail.com',
    '910583210099', 'approved', now()
  );

  v_result := public.record_checkout_payment_snapshot(
    v_snapshot_mutation, '910583210010', 'approved', 'pref-local',
    79.90, 'brl', '2026-10-06 15:04:05+00'
  );
  IF v_result->>'ok' IS DISTINCT FROM 'true' OR v_result->>'snapshot_stored' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'snapshot_not_stored: %', v_result;
  END IF;

  SELECT transaction_amount, transaction_currency, transaction_paid_at, transaction_snapshot_conflict
  INTO v_amount, v_currency_code, v_paid, v_conflict
  FROM public.checkout_sessions
  WHERE id = v_snapshot;
  IF v_amount IS DISTINCT FROM 79.90 OR v_currency_code IS DISTINCT FROM 'BRL' OR v_paid IS NULL OR v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'snapshot_fields_mismatch';
  END IF;

  v_result := public.record_checkout_payment_snapshot(
    v_snapshot_mutation, '910583210010', 'approved', 'pref-local',
    79.90, 'BRL', '2026-10-06 18:00:00+00'
  );
  SELECT transaction_amount, transaction_paid_at, transaction_snapshot_conflict
  INTO v_amount, v_paid_again, v_conflict
  FROM public.checkout_sessions
  WHERE id = v_snapshot;
  IF v_result->>'replay' IS DISTINCT FROM 'true'
     OR v_amount IS DISTINCT FROM 79.90
     OR v_paid_again IS DISTINCT FROM v_paid
     OR v_conflict IS NOT NULL
  THEN
    RAISE EXCEPTION 'snapshot_replay_changed_history';
  END IF;

  v_result := public.record_checkout_payment_snapshot(
    v_snapshot_mutation, '910583210010', 'approved', 'pref-local',
    10.00, 'BRL', '2026-10-06 18:00:00+00'
  );
  SELECT transaction_amount, transaction_currency, transaction_paid_at, transaction_snapshot_conflict
  INTO v_amount, v_currency_code, v_paid_again, v_conflict
  FROM public.checkout_sessions
  WHERE id = v_snapshot;
  IF v_result->>'snapshot_conflict' IS DISTINCT FROM 'amount'
     OR v_amount IS DISTINCT FROM 79.90
     OR v_currency_code IS DISTINCT FROM 'BRL'
     OR v_paid_again IS DISTINCT FROM v_paid
     OR v_conflict IS DISTINCT FROM 'amount'
  THEN
    RAISE EXCEPTION 'amount_conflict_overwrote_snapshot';
  END IF;

  BEGIN
    UPDATE public.checkout_sessions
    SET transaction_amount = 1.00
    WHERE id = v_snapshot;
    RAISE EXCEPTION 'snapshot_overwrite_was_allowed';
  EXCEPTION
    WHEN SQLSTATE '23514' THEN
      NULL;
  END;

  v_result := public.record_checkout_payment_snapshot(
    v_currency_mutation, '910583210014', 'approved', NULL,
    50.00, 'BRL', '2026-10-06 15:04:05+00'
  );
  v_result := public.record_checkout_payment_snapshot(
    v_currency_mutation, '910583210014', 'approved', NULL,
    50.00, 'USD', '2026-10-06 16:00:00+00'
  );
  SELECT transaction_amount, transaction_currency, transaction_snapshot_conflict
  INTO v_amount, v_currency_code, v_conflict
  FROM public.checkout_sessions
  WHERE id = v_currency;
  IF v_amount IS DISTINCT FROM 50.00 OR v_currency_code IS DISTINCT FROM 'BRL' OR v_conflict IS DISTINCT FROM 'currency' THEN
    RAISE EXCEPTION 'currency_conflict_overwrote_snapshot';
  END IF;

  v_result := public.record_checkout_payment_snapshot(
    v_legacy_mutation, '910583210099', 'approved', NULL,
    80.00, 'BRL', '2026-10-06 15:04:05+00'
  );
  SELECT transaction_amount INTO v_amount FROM public.checkout_sessions WHERE id = v_legacy;
  IF v_amount IS NOT NULL OR v_result->>'snapshot_stored' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'legacy_payment_was_backfilled';
  END IF;

  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.checkout_sessions
    SET transaction_amount = 2.00
    WHERE id = v_snapshot;
    RAISE EXCEPTION 'authenticated_snapshot_update_succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  INSERT INTO public.refund_requests (
    id, client_mutation_id, mp_payment_id, payer_email, reason,
    intensive_use_declared, window_assessment, status, request_fingerprint
  ) VALUES
    (v_restart, '58321000-0000-4000-8000-0000000000c1', '910583210301', 'snapshot-phase-58321@gmail.com', 'arrependimento', false, 'within_window', 'approved', 'phase-58321-restart'),
    (v_retry, '58321000-0000-4000-8000-0000000000c2', '910583210302', 'snapshot-phase-58321@gmail.com', 'arrependimento', false, 'within_window', 'approved', 'phase-58321-retry'),
    (v_blocked, '58321000-0000-4000-8000-0000000000c3', '910583210303', 'snapshot-phase-58321@gmail.com', 'arrependimento', false, 'within_window', 'submitted', 'phase-58321-blocked'),
    (v_duplicate, '58321000-0000-4000-8000-0000000000c4', '910583210301', 'snapshot-phase-58321@gmail.com', 'arrependimento', false, 'within_window', 'approved', 'phase-58321-duplicate'),
    (v_race_refund, '58321000-0000-4000-8000-0000000000c5', '910583210305', 'snapshot-phase-58321@gmail.com', 'arrependimento', false, 'within_window', 'approved', 'phase-58321-race');

  v_result := public.claim_refund_processing(v_blocked, false);
  IF v_result->>'acquired' IS DISTINCT FROM 'false' OR v_result->>'reason' IS DISTINCT FROM 'not_approved' THEN
    RAISE EXCEPTION 'submitted_request_was_claimed: %', v_result;
  END IF;

  v_result := public.claim_refund_processing(v_restart, false);
  IF v_result->>'acquired' IS DISTINCT FROM 'true'
     OR v_result->>'idempotency_key' IS DISTINCT FROM 'mercadopago:refund:' || v_restart::text
     OR v_result->>'provider_refund_status' IS DISTINCT FROM 'not_sent'
     OR v_result->>'processing_attempts' IS DISTINCT FROM '1'
  THEN
    RAISE EXCEPTION 'restart_claim_failed: %', v_result;
  END IF;

  v_result := public.claim_refund_processing(v_duplicate, false);
  IF v_result->>'acquired' IS DISTINCT FROM 'false' OR v_result->>'reason' IS DISTINCT FROM 'duplicate_payment' THEN
    RAISE EXCEPTION 'duplicate_payment_was_claimed: %', v_result;
  END IF;
  SELECT processing_state, processing_attempts INTO v_state, v_attempts
  FROM public.refund_requests WHERE id = v_duplicate;
  IF v_state IS NOT NULL OR v_attempts IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'duplicate_payment_created_a_claim';
  END IF;

  v_result := public.claim_refund_processing(v_retry, false);
  v_result := public.fail_refund_processing(v_retry, 'timeout access_token=hidden');
  SELECT last_processing_error, processing_state, processing_attempts, provider_refund_status, status, idempotency_key
  INTO v_error, v_state, v_attempts, v_provider_status, v_status, v_key
  FROM public.refund_requests WHERE id = v_retry;
  IF v_error IS DISTINCT FROM 'redacted'
     OR v_state IS DISTINCT FROM 'failed'
     OR v_attempts IS DISTINCT FROM 1
     OR v_provider_status IS DISTINCT FROM 'not_sent'
     OR v_status IS DISTINCT FROM 'approved'
     OR v_key IS DISTINCT FROM 'mercadopago:refund:' || v_retry::text
  THEN
    RAISE EXCEPTION 'failure_did_not_keep_the_claim';
  END IF;

  v_result := public.claim_refund_processing(v_retry, false);
  SELECT processing_attempts INTO v_attempts FROM public.refund_requests WHERE id = v_retry;
  IF v_result->>'reason' IS DISTINCT FROM 'retry_required' OR v_attempts IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'retry_without_flag_duplicated_claim';
  END IF;

  v_result := public.claim_refund_processing(v_retry, true);
  SELECT processing_attempts, idempotency_key, processing_state
  INTO v_attempts, v_key, v_state
  FROM public.refund_requests WHERE id = v_retry;
  IF v_result->>'reason' IS DISTINCT FROM 'retried'
     OR v_attempts IS DISTINCT FROM 2
     OR v_state IS DISTINCT FROM 'processing'
     OR v_key IS DISTINCT FROM 'mercadopago:refund:' || v_retry::text
  THEN
    RAISE EXCEPTION 'controlled_retry_changed_identity';
  END IF;

  v_result := public.complete_refund_processing_dry_run(v_retry);
  IF v_result->>'status' IS DISTINCT FROM 'processing_simulated'
     OR v_result->>'financial_effect' IS DISTINCT FROM 'false'
     OR v_result->>'provider_refund_id' IS NOT NULL
     OR v_result->>'provider_refund_status' IS DISTINCT FROM 'not_sent'
  THEN
    RAISE EXCEPTION 'dry_run_had_a_financial_effect: %', v_result;
  END IF;

  v_result := public.claim_refund_processing(v_retry, true);
  SELECT processing_attempts, provider_refund_status, status
  INTO v_attempts, v_provider_status, v_status
  FROM public.refund_requests WHERE id = v_retry;
  IF v_result->>'reason' IS DISTINCT FROM 'completed'
     OR v_attempts IS DISTINCT FROM 2
     OR v_provider_status IS DISTINCT FROM 'not_sent'
     OR v_status IS DISTINCT FROM 'approved'
  THEN
    RAISE EXCEPTION 'completed_dry_run_was_claimed_again';
  END IF;

  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.claim_refund_processing(v_race_refund, false);
    RAISE EXCEPTION 'authenticated_claim_succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  SELECT count(*) INTO v_index_count FROM public.refund_requests WHERE id = v_race_refund AND processing_state IS NULL;
  IF v_index_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'race_refund_was_claimed_early';
  END IF;
END $$;

-- Local assertions for sandbox refund settlement.
-- The shell deletes these rows and rolls the migration back.

DO $$
DECLARE
  v_plan uuid;
  v_user uuid;
  v_success uuid := '58321000-0000-4000-8000-0000000000e2';
  v_usd uuid := '58321000-0000-4000-8000-0000000000e4';
  v_missing uuid := '58321000-0000-4000-8000-0000000000e6';
  v_temporary uuid := '58321000-0000-4000-8000-0000000000e8';
  v_permanent uuid := '58321000-0000-4000-8000-0000000000ea';
  v_timeout uuid := '58321000-0000-4000-8000-0000000000ec';
  v_race uuid := '58321000-0000-4000-8000-0000000000ee';
  v_dry uuid := '58321000-0000-4000-8000-0000000000f0';
  v_result jsonb;
  v_status text;
  v_provider_status text;
  v_state text;
  v_key text;
  v_attempts integer;
  v_error text;
  v_class text;
  v_finished timestamptz;
  v_effect boolean;
  v_provider_id text;
  v_mock text := 'sandbox_0123456789abcdef0123456789abcdef';
  v_other_mock text := 'sandbox_abcdefabcdefabcdefabcdefabcdefab';
BEGIN
  SELECT id INTO v_plan FROM public.plans LIMIT 1;
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'local_plan_missing';
  END IF;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'local_user_missing';
  END IF;

  DELETE FROM public.refund_requests
  WHERE id IN (v_success, v_usd, v_missing, v_temporary, v_permanent, v_timeout, v_race, v_dry);
  DELETE FROM public.checkout_sessions
  WHERE id IN (
    '58321000-0000-4000-8000-0000000000e1',
    '58321000-0000-4000-8000-0000000000e3',
    '58321000-0000-4000-8000-0000000000e5',
    '58321000-0000-4000-8000-0000000000e7',
    '58321000-0000-4000-8000-0000000000e9',
    '58321000-0000-4000-8000-0000000000eb',
    '58321000-0000-4000-8000-0000000000ed',
    '58321000-0000-4000-8000-0000000000ef'
  );

  INSERT INTO public.checkout_sessions (
    id, client_mutation_id, plan_id, payer_email, mp_payment_id, onboarding_user_id,
    transaction_amount, transaction_currency, transaction_paid_at
  ) VALUES
    ('58321000-0000-4000-8000-0000000000e1', '58321000-0000-4000-8000-0000000000d1', v_plan, 'sandbox-refund-phase4@example.com', '910583210401', v_user, 100.00, 'BRL', '2026-10-01 15:00:00+00'),
    ('58321000-0000-4000-8000-0000000000e3', '58321000-0000-4000-8000-0000000000d3', v_plan, 'sandbox-refund-phase4@example.com', '910583210403', v_user, 100.00, 'USD', '2026-10-01 15:00:00+00'),
    ('58321000-0000-4000-8000-0000000000e5', '58321000-0000-4000-8000-0000000000d5', v_plan, 'sandbox-refund-phase4@example.com', '910583210404', v_user, NULL, NULL, NULL),
    ('58321000-0000-4000-8000-0000000000e7', '58321000-0000-4000-8000-0000000000d7', v_plan, 'sandbox-refund-phase4@example.com', '910583210405', v_user, 80.00, 'BRL', '2026-10-01 15:00:00+00'),
    ('58321000-0000-4000-8000-0000000000e9', '58321000-0000-4000-8000-0000000000d9', v_plan, 'sandbox-refund-phase4@example.com', '910583210406', v_user, 80.00, 'BRL', '2026-10-01 15:00:00+00'),
    ('58321000-0000-4000-8000-0000000000eb', '58321000-0000-4000-8000-0000000000db', v_plan, 'sandbox-refund-phase4@example.com', '910583210407', v_user, 80.00, 'BRL', '2026-10-01 15:00:00+00'),
    ('58321000-0000-4000-8000-0000000000ed', '58321000-0000-4000-8000-0000000000dd', v_plan, 'sandbox-refund-phase4@example.com', '910583210408', v_user, 100.00, 'BRL', '2026-10-01 15:00:00+00');

  INSERT INTO public.checkout_sessions (id, client_mutation_id, plan_id, payer_email, mp_payment_id)
  VALUES (
    '58321000-0000-4000-8000-0000000000ef',
    '58321000-0000-4000-8000-0000000000df',
    v_plan,
    'sandbox-refund-phase4@example.com',
    '910583210409'
  );

  INSERT INTO public.refund_requests (
    id, client_mutation_id, mp_payment_id, payer_email, reason,
    intensive_use_declared, window_assessment, status, request_fingerprint
  ) VALUES
    (v_success, '58321000-0000-4000-8000-0000000000c1', '910583210401', 'sandbox-refund-phase4@example.com', 'arrependimento', false, 'within_window', 'approved', 'sandbox-phase4-success'),
    (v_usd, '58321000-0000-4000-8000-0000000000c3', '910583210403', 'sandbox-refund-phase4@example.com', 'arrependimento', false, 'within_window', 'approved', 'sandbox-phase4-usd'),
    (v_missing, '58321000-0000-4000-8000-0000000000c5', '910583210404', 'sandbox-refund-phase4@example.com', 'arrependimento', false, 'within_window', 'approved', 'sandbox-phase4-missing'),
    (v_temporary, '58321000-0000-4000-8000-0000000000c7', '910583210405', 'sandbox-refund-phase4@example.com', 'arrependimento', false, 'within_window', 'approved', 'sandbox-phase4-temporary'),
    (v_permanent, '58321000-0000-4000-8000-0000000000c9', '910583210406', 'sandbox-refund-phase4@example.com', 'arrependimento', false, 'within_window', 'approved', 'sandbox-phase4-permanent'),
    (v_timeout, '58321000-0000-4000-8000-0000000000cb', '910583210407', 'sandbox-refund-phase4@example.com', 'arrependimento', false, 'within_window', 'approved', 'sandbox-phase4-timeout'),
    (v_race, '58321000-0000-4000-8000-0000000000cd', '910583210408', 'sandbox-refund-phase4@example.com', 'arrependimento', false, 'within_window', 'approved', 'sandbox-phase4-race'),
    (v_dry, '58321000-0000-4000-8000-0000000000cf', '910583210409', 'sandbox-refund-phase4@example.com', 'arrependimento', false, 'within_window', 'approved', 'sandbox-phase4-dry');

  v_result := public.claim_refund_processing(v_dry, false);
  v_result := public.fail_refund_processing(v_dry, 'dry-run');
  v_result := public.claim_refund_processing(v_dry, true);
  v_result := public.complete_refund_processing_dry_run(v_dry);
  SELECT status, provider_refund_status, processing_state, financial_effect, provider_refund_id
  INTO v_status, v_provider_status, v_state, v_effect, v_provider_id
  FROM public.refund_requests WHERE id = v_dry;
  IF v_result->>'financial_effect' IS DISTINCT FROM 'false'
     OR v_status IS DISTINCT FROM 'approved'
     OR v_provider_status IS DISTINCT FROM 'not_sent'
     OR v_state IS DISTINCT FROM 'simulated'
     OR v_effect IS DISTINCT FROM false
     OR v_provider_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'dry_run_changed_under_sandbox_schema: %', v_result;
  END IF;

  v_result := public.claim_refund_processing(v_missing, false);
  v_result := public.dispatch_sandbox_refund(v_missing, v_user);
  SELECT status, provider_refund_status INTO v_status, v_provider_status
  FROM public.refund_requests WHERE id = v_missing;
  IF v_result->>'error' IS DISTINCT FROM 'paid_amount_unavailable'
     OR v_status IS DISTINCT FROM 'approved'
     OR v_provider_status IS DISTINCT FROM 'not_sent'
  THEN
    RAISE EXCEPTION 'missing_snapshot_was_dispatched: %', v_result;
  END IF;

  v_result := public.claim_refund_processing(v_usd, false);
  v_result := public.dispatch_sandbox_refund(v_usd, v_user);
  SELECT status INTO v_status FROM public.refund_requests WHERE id = v_usd;
  IF v_result->>'error' IS DISTINCT FROM 'invalid_currency' OR v_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'non_brl_snapshot_was_dispatched: %', v_result;
  END IF;

  v_result := public.claim_refund_processing(v_success, false);
  v_result := public.dispatch_sandbox_refund(v_success, '58321000-0000-4000-8000-00000000aaaa');
  SELECT status, provider_refund_status INTO v_status, v_provider_status
  FROM public.refund_requests WHERE id = v_success;
  IF v_result->>'error' IS DISTINCT FROM 'not_owner'
     OR v_status IS DISTINCT FROM 'approved'
     OR v_provider_status IS DISTINCT FROM 'not_sent'
  THEN
    RAISE EXCEPTION 'other_client_was_dispatched: %', v_result;
  END IF;

  v_result := public.dispatch_sandbox_refund(v_success, v_user);
  IF v_result->>'ok' IS DISTINCT FROM 'true'
     OR v_result->>'status' IS DISTINCT FROM 'processing'
     OR v_result->>'provider_refund_status' IS DISTINCT FROM 'processing'
     OR v_result->>'financial_effect' IS DISTINCT FROM 'false'
     OR v_result->>'idempotency_key' IS DISTINCT FROM 'mercadopago:refund:' || v_success::text
  THEN
    RAISE EXCEPTION 'sandbox_dispatch_failed: %', v_result;
  END IF;

  v_result := public.complete_sandbox_refund(v_success, v_user, v_mock, 1.00, 'BRL');
  SELECT status INTO v_status FROM public.refund_requests WHERE id = v_success;
  IF v_result->>'error' IS DISTINCT FROM 'snapshot_amount_mismatch' OR v_status IS DISTINCT FROM 'processing' THEN
    RAISE EXCEPTION 'mismatched_amount_was_settled: %', v_result;
  END IF;

  v_result := public.complete_sandbox_refund(v_success, v_user, v_mock, 100.00, 'BRL');
  SELECT status, provider_refund_status, provider_refund_id, processing_finished_at, financial_effect, idempotency_key, processing_attempts
  INTO v_status, v_provider_status, v_provider_id, v_finished, v_effect, v_key, v_attempts
  FROM public.refund_requests WHERE id = v_success;
  IF v_result->>'financial_effect' IS DISTINCT FROM 'false'
     OR v_status IS DISTINCT FROM 'refunded'
     OR v_provider_status IS DISTINCT FROM 'completed'
     OR v_provider_id IS DISTINCT FROM v_mock
     OR v_finished IS NULL
     OR v_effect IS DISTINCT FROM false
     OR v_key IS DISTINCT FROM 'mercadopago:refund:' || v_success::text
     OR v_attempts IS DISTINCT FROM 1
  THEN
    RAISE EXCEPTION 'sandbox_success_was_not_recorded: %', v_result;
  END IF;

  v_result := public.complete_sandbox_refund(v_success, v_user, v_mock, 100.00, 'BRL');
  IF v_result->>'replay' IS DISTINCT FROM 'true' OR v_result->>'financial_effect' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'duplicate_confirmation_was_not_replayed: %', v_result;
  END IF;
  v_result := public.complete_sandbox_refund(v_success, v_user, v_other_mock, 100.00, 'BRL');
  SELECT provider_refund_id, processing_attempts INTO v_provider_id, v_attempts
  FROM public.refund_requests WHERE id = v_success;
  IF v_result->>'error' IS DISTINCT FROM 'already_refunded'
     OR v_provider_id IS DISTINCT FROM v_mock
     OR v_attempts IS DISTINCT FROM 1
  THEN
    RAISE EXCEPTION 'second_provider_id_was_stored: %', v_result;
  END IF;

  v_result := public.claim_refund_processing(v_success, true);
  IF v_result->>'acquired' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'refunded_request_was_claimed_again: %', v_result;
  END IF;

  v_result := public.claim_refund_processing(v_temporary, false);
  v_result := public.dispatch_sandbox_refund(v_temporary, v_user);
  v_result := public.fail_sandbox_refund(v_temporary, v_user, 'provider_unavailable access_token=hidden', 'temporary');
  SELECT status, provider_refund_status, last_processing_error, processing_error_class, processing_attempts, idempotency_key
  INTO v_status, v_provider_status, v_error, v_class, v_attempts, v_key
  FROM public.refund_requests WHERE id = v_temporary;
  IF v_status IS DISTINCT FROM 'processing'
     OR v_provider_status IS DISTINCT FROM 'failed'
     OR v_error IS DISTINCT FROM 'redacted'
     OR v_class IS DISTINCT FROM 'temporary'
     OR v_attempts IS DISTINCT FROM 1
     OR v_key IS DISTINCT FROM 'mercadopago:refund:' || v_temporary::text
  THEN
    RAISE EXCEPTION 'temporary_error_was_not_preserved: %', v_result;
  END IF;
  v_result := public.retry_sandbox_refund(v_temporary, v_user);
  SELECT processing_attempts, idempotency_key, processing_state, provider_refund_status
  INTO v_attempts, v_key, v_state, v_provider_status
  FROM public.refund_requests WHERE id = v_temporary;
  IF v_result->>'reason' IS DISTINCT FROM 'retried'
     OR v_attempts IS DISTINCT FROM 2
     OR v_key IS DISTINCT FROM 'mercadopago:refund:' || v_temporary::text
     OR v_state IS DISTINCT FROM 'processing'
     OR v_provider_status IS DISTINCT FROM 'processing'
  THEN
    RAISE EXCEPTION 'temporary_retry_changed_the_key: %', v_result;
  END IF;

  v_result := public.claim_refund_processing(v_permanent, false);
  v_result := public.dispatch_sandbox_refund(v_permanent, v_user);
  v_result := public.fail_sandbox_refund(v_permanent, v_user, 'refund_not_allowed', 'permanent');
  v_result := public.retry_sandbox_refund(v_permanent, v_user);
  SELECT status, processing_attempts INTO v_status, v_attempts FROM public.refund_requests WHERE id = v_permanent;
  IF v_result->>'error' IS DISTINCT FROM 'not_retryable'
     OR v_status IS DISTINCT FROM 'processing'
     OR v_attempts IS DISTINCT FROM 1
  THEN
    RAISE EXCEPTION 'permanent_error_was_retried: %', v_result;
  END IF;

  v_result := public.claim_refund_processing(v_timeout, false);
  v_result := public.dispatch_sandbox_refund(v_timeout, v_user);
  v_result := public.timeout_sandbox_refund(v_timeout, v_user);
  SELECT status, provider_refund_status, processing_state, processing_error_class, provider_refund_id, processing_finished_at
  INTO v_status, v_provider_status, v_state, v_class, v_provider_id, v_finished
  FROM public.refund_requests WHERE id = v_timeout;
  IF v_status IS DISTINCT FROM 'processing'
     OR v_provider_status IS DISTINCT FROM 'processing'
     OR v_state IS DISTINCT FROM 'unknown'
     OR v_class IS DISTINCT FROM 'timeout'
     OR v_provider_id IS NOT NULL
     OR v_finished IS NOT NULL
  THEN
    RAISE EXCEPTION 'timeout_was_treated_as_a_final_result: %', v_result;
  END IF;
  v_result := public.retry_sandbox_refund(v_timeout, v_user);
  SELECT idempotency_key, processing_attempts INTO v_key, v_attempts FROM public.refund_requests WHERE id = v_timeout;
  IF v_result->>'reason' IS DISTINCT FROM 'retried'
     OR v_key IS DISTINCT FROM 'mercadopago:refund:' || v_timeout::text
     OR v_attempts IS DISTINCT FROM 2
  THEN
    RAISE EXCEPTION 'timeout_retry_changed_the_key: %', v_result;
  END IF;

  v_result := public.claim_refund_processing(v_race, false);
  v_result := public.dispatch_sandbox_refund(v_race, v_user);
  SELECT status, provider_refund_status, processing_attempts INTO v_status, v_provider_status, v_attempts
  FROM public.refund_requests WHERE id = v_race;
  IF v_status IS DISTINCT FROM 'processing'
     OR v_provider_status IS DISTINCT FROM 'processing'
     OR v_attempts IS DISTINCT FROM 1
  THEN
    RAISE EXCEPTION 'race_row_was_not_dispatched: %', v_result;
  END IF;

  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.complete_sandbox_refund(v_race, v_user, 'sandbox_11111111111111111111111111111111', 100.00, 'BRL');
    RAISE EXCEPTION 'authenticated_sandbox_complete_succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END $$;

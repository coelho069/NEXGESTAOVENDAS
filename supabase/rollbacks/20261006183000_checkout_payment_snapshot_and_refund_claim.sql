-- Logical rollback for 20261006183000. Local validation only.
-- Drops the snapshot and the persistent refund claim. Does not delete
-- checkout_sessions or refund_requests rows.

DROP FUNCTION IF EXISTS public.fail_refund_processing(uuid, text);
DROP FUNCTION IF EXISTS public.complete_refund_processing_dry_run(uuid);
DROP FUNCTION IF EXISTS public.claim_refund_processing(uuid, boolean);
DROP FUNCTION IF EXISTS public.record_checkout_payment_snapshot(uuid, text, text, text, numeric, text, timestamptz);

DROP TRIGGER IF EXISTS checkout_sessions_protect_transaction_snapshot ON public.checkout_sessions;
DROP FUNCTION IF EXISTS public.protect_checkout_transaction_snapshot();

DROP INDEX IF EXISTS public.refund_requests_payment_processing_uidx;
DROP INDEX IF EXISTS public.refund_requests_idempotency_key_uidx;
DROP INDEX IF EXISTS public.checkout_sessions_snapshot_conflict_idx;

ALTER TABLE public.refund_requests
  DROP CONSTRAINT IF EXISTS refund_requests_processing_terminal_check,
  DROP CONSTRAINT IF EXISTS refund_requests_processing_shape_check,
  DROP CONSTRAINT IF EXISTS refund_requests_idempotency_key_check,
  DROP CONSTRAINT IF EXISTS refund_requests_processing_error_length_check,
  DROP CONSTRAINT IF EXISTS refund_requests_processing_attempts_check;

ALTER TABLE public.checkout_sessions
  DROP CONSTRAINT IF EXISTS checkout_sessions_transaction_snapshot_conflict_check,
  DROP CONSTRAINT IF EXISTS checkout_sessions_transaction_currency_check,
  DROP CONSTRAINT IF EXISTS checkout_sessions_transaction_amount_positive_check,
  DROP CONSTRAINT IF EXISTS checkout_sessions_transaction_snapshot_complete_check;

ALTER TABLE public.refund_requests
  DROP COLUMN IF EXISTS processing_state,
  DROP COLUMN IF EXISTS last_processing_error,
  DROP COLUMN IF EXISTS processing_attempts,
  DROP COLUMN IF EXISTS processing_finished_at,
  DROP COLUMN IF EXISTS processing_started_at,
  DROP COLUMN IF EXISTS idempotency_key;

ALTER TABLE public.checkout_sessions
  DROP COLUMN IF EXISTS transaction_snapshot_conflict_at,
  DROP COLUMN IF EXISTS transaction_snapshot_conflict,
  DROP COLUMN IF EXISTS transaction_paid_at,
  DROP COLUMN IF EXISTS transaction_currency,
  DROP COLUMN IF EXISTS transaction_amount;

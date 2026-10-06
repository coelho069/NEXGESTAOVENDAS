-- Local rollback for 20261006193000. Restores the dry-run claim checks.
-- Stops if a sandbox settlement row is still present. Does not rewrite payments.

DO $$
DECLARE
  v_blocked integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'refund_requests'
      AND column_name = 'provider_refund_id'
  ) THEN
    RETURN;
  END IF;

  EXECUTE $guard$
    SELECT count(*)
    FROM public.refund_requests
    WHERE status IN ('processing', 'refunded')
       OR provider_refund_status <> 'not_sent'
       OR provider_refund_id IS NOT NULL
       OR processing_state IN ('unknown', 'completed')
       OR processing_error_class IS NOT NULL
       OR financial_effect IS TRUE
  $guard$
  INTO v_blocked;

  IF v_blocked > 0 THEN
    RAISE EXCEPTION 'sandbox_rows_present_rollback_stopped';
  END IF;
END $$;

DROP TRIGGER IF EXISTS refund_requests_protect_sandbox_settlement ON public.refund_requests;
DROP FUNCTION IF EXISTS public.protect_sandbox_refund_settlement();
DROP FUNCTION IF EXISTS public.retry_sandbox_refund(uuid, uuid);
DROP FUNCTION IF EXISTS public.timeout_sandbox_refund(uuid, uuid);
DROP FUNCTION IF EXISTS public.fail_sandbox_refund(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.complete_sandbox_refund(uuid, uuid, text, numeric, text);
DROP FUNCTION IF EXISTS public.dispatch_sandbox_refund(uuid, uuid);

DROP INDEX IF EXISTS public.refund_requests_provider_refund_id_uidx;

ALTER TABLE public.refund_requests
  DROP CONSTRAINT IF EXISTS refund_requests_processing_shape_check,
  DROP CONSTRAINT IF EXISTS refund_requests_processing_terminal_check,
  DROP CONSTRAINT IF EXISTS refund_requests_status_check,
  DROP CONSTRAINT IF EXISTS refund_requests_provider_refund_status_check,
  DROP CONSTRAINT IF EXISTS refund_requests_financial_effect_false_check,
  DROP CONSTRAINT IF EXISTS refund_requests_processing_error_class_check,
  DROP CONSTRAINT IF EXISTS refund_requests_provider_refund_id_format_check;

ALTER TABLE public.refund_requests
  DROP COLUMN IF EXISTS financial_effect,
  DROP COLUMN IF EXISTS processing_error_class,
  DROP COLUMN IF EXISTS provider_refund_id;

ALTER TABLE public.refund_requests
  ADD CONSTRAINT refund_requests_status_check
    CHECK (status IN ('submitted', 'in_review', 'approved', 'rejected', 'withdrawn')),
  ADD CONSTRAINT refund_requests_provider_refund_status_check
    CHECK (provider_refund_status = 'not_sent'),
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
    ),
  ADD CONSTRAINT refund_requests_processing_terminal_check
    CHECK (
      (processing_state IS DISTINCT FROM 'simulated' OR processing_finished_at IS NOT NULL)
      AND (processing_state IS DISTINCT FROM 'processing' OR processing_finished_at IS NULL)
      AND (processing_state IS DISTINCT FROM 'failed' OR processing_finished_at IS NULL)
    );

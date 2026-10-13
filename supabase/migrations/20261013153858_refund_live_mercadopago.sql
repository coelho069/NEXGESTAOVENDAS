-- Live Mercado Pago refund settlement.
-- A numeric provider refund id may be stored, and financial_effect may become
-- true only after status refunded + provider completed + a numeric refund id.
-- Once financial_effect is true it cannot revert.
-- This file is not applied by the change that adds it.

COMMENT ON COLUMN public.refund_requests.provider_refund_id IS
  'Sandbox id sandbox_<32 hex>, or a live Mercado Pago refund id of 1 to 20 digits.';
COMMENT ON COLUMN public.refund_requests.financial_effect IS
  'True only after a live Mercado Pago refund is confirmed. Sandbox settlement stays false.';

ALTER TABLE public.refund_requests
  DROP CONSTRAINT IF EXISTS refund_requests_provider_refund_id_format_check;

ALTER TABLE public.refund_requests
  ADD CONSTRAINT refund_requests_provider_refund_id_format_check
    CHECK (
      provider_refund_id IS NULL
      OR provider_refund_id ~ '^sandbox_[a-f0-9]{32}$'
      OR provider_refund_id ~ '^[0-9]{1,20}$'
    );

ALTER TABLE public.refund_requests
  DROP CONSTRAINT IF EXISTS refund_requests_financial_effect_false_check;

ALTER TABLE public.refund_requests
  ADD CONSTRAINT refund_requests_financial_effect_false_check
    CHECK (
      financial_effect = false
      OR (
        status = 'refunded'
        AND provider_refund_status = 'completed'
        AND provider_refund_id ~ '^[0-9]{1,20}$'
      )
    );

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
  IF OLD.financial_effect IS TRUE AND NEW.financial_effect IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'financial_effect_immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.financial_effect IS TRUE
     AND NOT (
       NEW.status = 'refunded'
       AND NEW.provider_refund_status = 'completed'
       AND NEW.provider_refund_id ~ '^[0-9]{1,20}$'
     )
  THEN
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

REVOKE ALL ON FUNCTION public.protect_sandbox_refund_settlement() FROM PUBLIC, anon, authenticated;

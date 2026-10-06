-- SaaS refund requests. Analysis workflow only.
-- Approving a row must not call Mercado Pago. provider_refund_status
-- accepts only 'not_sent' until a later migration adds a dispatch state.
-- Do not apply this file to remote production from the phase-2 change.

CREATE TABLE IF NOT EXISTS public.refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_mutation_id uuid NOT NULL UNIQUE,
  mp_payment_id text NOT NULL
    CHECK (mp_payment_id ~ '^[0-9]{6,20}$'),
  payer_email text NOT NULL,
  reason text NOT NULL
    CHECK (reason IN ('desistencia', 'cobranca_indevida', 'nao_utilizou', 'outro')),
  notes text NOT NULL DEFAULT '',
  intensive_use_declared boolean NOT NULL,
  paid_on date,
  window_assessment text NOT NULL
    CHECK (window_assessment IN ('within_window', 'outside_window', 'unknown')),
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'in_review', 'approved', 'rejected', 'withdrawn')),
  request_fingerprint text NOT NULL,
  resolution_note text,
  reviewed_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  checkout_session_id uuid REFERENCES public.checkout_sessions (id) ON DELETE SET NULL,
  payer_email_matches_checkout boolean,
  provider text NOT NULL DEFAULT 'mercadopago'
    CHECK (provider = 'mercadopago'),
  provider_refund_status text NOT NULL DEFAULT 'not_sent'
    CHECK (provider_refund_status = 'not_sent'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    reason <> 'outro'
    OR char_length(btrim(notes)) >= 3
  )
);

COMMENT ON TABLE public.refund_requests IS
  'SaaS refund analysis queue for Mercado Pago Checkout Pro payments. No provider refund is sent from this table.';

CREATE UNIQUE INDEX IF NOT EXISTS refund_requests_open_payment_uidx
  ON public.refund_requests (mp_payment_id)
  WHERE status IN ('submitted', 'in_review');

CREATE INDEX IF NOT EXISTS refund_requests_status_created_idx
  ON public.refund_requests (status, created_at DESC);

DROP TRIGGER IF EXISTS refund_requests_set_updated_at ON public.refund_requests;
CREATE TRIGGER refund_requests_set_updated_at
  BEFORE UPDATE ON public.refund_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS refund_requests_deny ON public.refund_requests;
CREATE POLICY refund_requests_deny
  ON public.refund_requests
  FOR ALL TO PUBLIC
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.refund_requests FROM PUBLIC;
REVOKE ALL ON TABLE public.refund_requests FROM anon;
REVOKE ALL ON TABLE public.refund_requests FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.refund_requests TO service_role;

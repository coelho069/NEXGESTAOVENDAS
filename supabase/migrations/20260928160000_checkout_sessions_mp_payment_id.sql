-- Checkout Pro (Preference) payment linkage for public checkout_sessions.
-- Idempotency anchor: mp_payment_id (Mercado Pago /v1/payments id).

ALTER TABLE public.checkout_sessions
  ADD COLUMN IF NOT EXISTS mp_payment_id text,
  ADD COLUMN IF NOT EXISTS mp_payment_status text,
  ADD COLUMN IF NOT EXISTS mp_preference_id text,
  ADD COLUMN IF NOT EXISTS mp_payment_paid_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS checkout_sessions_mp_payment_unique_idx
  ON public.checkout_sessions (mp_payment_id)
  WHERE mp_payment_id IS NOT NULL;

COMMENT ON COLUMN public.checkout_sessions.mp_payment_id IS
  'Mercado Pago /v1/payments id for Checkout Pro approval (idempotency key).';
COMMENT ON COLUMN public.checkout_sessions.mp_payment_status IS
  'Last known MP payment status (approved, pending, rejected, etc.).';
COMMENT ON COLUMN public.checkout_sessions.mp_preference_id IS
  'Mercado Pago Preference id linked to this checkout session.';
COMMENT ON COLUMN public.checkout_sessions.mp_payment_paid_at IS
  'UTC timestamp when MP payment status was confirmed as approved.';

-- Plano pago via PIX (pagamento único por período) + linkage da MP Order.
-- PIX no Mercado Pago não é recorrente: cada ciclo é cobrado como uma order
-- /v1/orders com payment_method.id='pix' (mesma gateway usada no PDV).

-- ---------------------------------------------------------------------------
-- plans.payment_method: 'card' (checkout hospedado MP Assinaturas, padrão dos
-- planos atuais) | 'pix' (order PIX única por período).
-- ---------------------------------------------------------------------------
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'card';

ALTER TABLE public.plans
  DROP CONSTRAINT IF EXISTS plans_payment_method_check;

ALTER TABLE public.plans
  ADD CONSTRAINT plans_payment_method_check
  CHECK (payment_method IN ('card', 'pix'));

COMMENT ON COLUMN public.plans.payment_method IS
  'card = recorrência via MP Assinaturas (hosted checkout); pix = cobrança PIX única por período via MP Orders.';

-- Planos existentes são todos card (seed de assinaturas).
UPDATE public.plans
SET payment_method = 'card'
WHERE payment_method IS DISTINCT FROM 'card'
  AND payment_method IS NOT NULL;

-- ---------------------------------------------------------------------------
-- checkout_sessions: cobrança PIX (MP Order) da sessão pública.
-- ---------------------------------------------------------------------------
ALTER TABLE public.checkout_sessions
  ADD COLUMN IF NOT EXISTS pix_order_id text,
  ADD COLUMN IF NOT EXISTS pix_order_amount numeric(12, 2)
    CHECK (pix_order_amount IS NULL OR pix_order_amount >= 0),
  ADD COLUMN IF NOT EXISTS pix_order_status text,
  ADD COLUMN IF NOT EXISTS pix_paid_at timestamptz;

-- Uma order PIX por sessão; eventos do webhook casam por pix_order_id.
CREATE UNIQUE INDEX IF NOT EXISTS checkout_sessions_pix_order_unique_idx
  ON public.checkout_sessions (pix_order_id)
  WHERE pix_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS checkout_sessions_payer_plan_active_idx
  ON public.checkout_sessions (plan_id, lower(payer_email))
  WHERE status IN ('pending', 'failed');

COMMENT ON COLUMN public.checkout_sessions.pix_order_id IS
  'Mercado Pago /v1/orders id da cobrança PIX desta sessão (planos payment_method=pix).';
COMMENT ON COLUMN public.checkout_sessions.pix_order_amount IS
  'Valor esperado da cobrança PIX (numeric(12,2)).';
COMMENT ON COLUMN public.checkout_sessions.pix_order_status IS
  'Último estado conhecido da order PIX: created | processed | canceled | refunded.';
COMMENT ON COLUMN public.checkout_sessions.pix_paid_at IS
  'UTC timestamp em que a order PIX foi confirmada como accredited.';

-- ---------------------------------------------------------------------------
-- Seed do plano Pix (idempotente por slug).
-- PIX não tem recorrência automática: cobrança mensal manual por período.
-- ---------------------------------------------------------------------------
INSERT INTO public.plans (
  slug,
  name,
  description,
  amount,
  currency,
  billing_interval,
  payment_method,
  is_active
)
VALUES
  (
    'pix',
    'Plano Pix',
    'PDV offline-first com pagamento via PIX. Sem recorrência automática: pague o mês quando quiser continuar.',
    79.90,
    'BRL',
    'monthly',
    'pix',
    true
  )
ON CONFLICT (slug)
DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  amount = EXCLUDED.amount,
  currency = EXCLUDED.currency,
  billing_interval = EXCLUDED.billing_interval,
  payment_method = EXCLUDED.payment_method,
  is_active = EXCLUDED.is_active,
  updated_at = now();

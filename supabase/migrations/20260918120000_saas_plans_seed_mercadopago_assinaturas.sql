-- SaaS Assinaturas: public plan seed + Mercado Pago preapproval provider columns.
-- Isolated from PDV MERCADOPAGO_CHECKOUT_ENABLED (Orders PIX).

-- ---------------------------------------------------------------------------
-- plans: slug for idempotent seed + MP preapproval_plan id
-- ---------------------------------------------------------------------------
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS mp_preapproval_plan_id text;

ALTER TABLE public.plans
  DROP CONSTRAINT IF EXISTS plans_slug_key;

ALTER TABLE public.plans
  ADD CONSTRAINT plans_slug_key UNIQUE (slug);

COMMENT ON COLUMN public.plans.slug IS
  'Stable catalog key for idempotent plan seed (essencial, profissional, enterprise).';

COMMENT ON COLUMN public.plans.mp_preapproval_plan_id IS
  'Mercado Pago /preapproval_plan id for SaaS checkout (not PDV Orders).';

-- ---------------------------------------------------------------------------
-- subscriptions: MP preapproval checkout linkage
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS mp_preapproval_id text,
  ADD COLUMN IF NOT EXISTS checkout_client_mutation_id uuid,
  ADD COLUMN IF NOT EXISTS mp_payer_email text;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_mp_preapproval_unique_idx
  ON public.subscriptions (mp_preapproval_id)
  WHERE mp_preapproval_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_checkout_mutation_unique_idx
  ON public.subscriptions (org_id, checkout_client_mutation_id)
  WHERE checkout_client_mutation_id IS NOT NULL;

COMMENT ON COLUMN public.subscriptions.mp_preapproval_id IS
  'Mercado Pago /preapproval id for SaaS subscription checkout.';

-- ---------------------------------------------------------------------------
-- subscription_provider_events: webhook idempotency (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_provider_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  provider_ref text,
  org_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL,
  subscription_id uuid REFERENCES public.subscriptions (id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscription_provider_events_provider_ref_idx
  ON public.subscription_provider_events (provider_ref, created_at DESC);

CREATE INDEX IF NOT EXISTS subscription_provider_events_org_idx
  ON public.subscription_provider_events (org_id, created_at DESC);

ALTER TABLE public.subscription_provider_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscription_provider_events_deny ON public.subscription_provider_events;
CREATE POLICY subscription_provider_events_deny
  ON public.subscription_provider_events
  FOR ALL TO PUBLIC
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.subscription_provider_events FROM PUBLIC;
REVOKE ALL ON TABLE public.subscription_provider_events FROM anon;
REVOKE ALL ON TABLE public.subscription_provider_events FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.subscription_provider_events TO service_role;

-- ---------------------------------------------------------------------------
-- RPC: reconcile MP Assinaturas webhook (service_role only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_subscription_mercadopago_event(
  p_event_id text,
  p_event_type text,
  p_provider_ref text,
  p_org_id uuid,
  p_subscription_status public.subscription_status,
  p_period_start date,
  p_period_end date,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_existing public.subscription_provider_events%ROWTYPE;
  v_subscription public.subscriptions%ROWTYPE;
  v_cancelled_at timestamptz;
BEGIN
  IF btrim(coalesce(p_event_id, '')) = '' THEN
    RAISE EXCEPTION 'subscription_event_id_required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.subscription_provider_events
  WHERE event_id = p_event_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'replay', true,
      'event_id', p_event_id,
      'subscription_id', v_existing.subscription_id,
      'status', (
        SELECT s.status
        FROM public.subscriptions s
        WHERE s.id = v_existing.subscription_id
      )
    );
  END IF;

  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'subscription_org_required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_subscription
  FROM public.subscriptions
  WHERE org_id = p_org_id
    AND (
      mp_preapproval_id = p_provider_ref
      OR status IN ('active', 'trialing', 'past_due')
    )
  ORDER BY
    CASE WHEN mp_preapproval_id = p_provider_ref THEN 0 ELSE 1 END,
    updated_at DESC
  LIMIT 1;

  v_cancelled_at := NULL;
  IF p_subscription_status IN ('canceled', 'cancelled') THEN
    v_cancelled_at := now();
  END IF;

  IF v_subscription.id IS NULL THEN
    RAISE EXCEPTION 'subscription_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.subscriptions
  SET
    status = p_subscription_status,
    mp_preapproval_id = coalesce(p_provider_ref, mp_preapproval_id),
    period_start = p_period_start,
    period_end = p_period_end,
    cancelled_at = v_cancelled_at,
    updated_at = now()
  WHERE id = v_subscription.id;

  INSERT INTO public.subscription_provider_events (
    event_id,
    event_type,
    provider_ref,
    org_id,
    subscription_id,
    payload
  )
  VALUES (
    p_event_id,
    p_event_type,
    p_provider_ref,
    p_org_id,
    v_subscription.id,
    coalesce(p_payload, '{}'::jsonb)
  );

  RETURN jsonb_build_object(
    'replay', false,
    'event_id', p_event_id,
    'subscription_id', v_subscription.id,
    'status', p_subscription_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_subscription_mercadopago_event(
  text, text, text, uuid, public.subscription_status, date, date, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_subscription_mercadopago_event(
  text, text, text, uuid, public.subscription_status, date, date, jsonb
) FROM anon;
REVOKE ALL ON FUNCTION public.apply_subscription_mercadopago_event(
  text, text, text, uuid, public.subscription_status, date, date, jsonb
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_subscription_mercadopago_event(
  text, text, text, uuid, public.subscription_status, date, date, jsonb
) TO service_role;

-- ---------------------------------------------------------------------------
-- Seed/replace public SaaS plans (idempotent upsert by slug)
-- Amounts (BRL monthly, documented):
--   essencial     99.90 — 1 loja, PDV offline-first (entry tier on vitrine)
--   profissional 199.90 — até 3 lojas, hotkeys + StockMap (middle / Mais Popular)
--   enterprise   499.90 — lojas ilimitadas, dashboard + CSV (enterprise tier)
-- Vitrine maps sorted prices to Essencial / Crescimento / Escala labels.
-- ---------------------------------------------------------------------------
INSERT INTO public.plans (
  slug,
  name,
  description,
  amount,
  currency,
  billing_interval,
  is_active
)
VALUES
  (
    'essencial',
    'Essencial',
    'PDV offline-first, estoque auditado e 1 loja.',
    99.90,
    'BRL',
    'monthly',
    true
  ),
  (
    'profissional',
    'Profissional',
    'Hotkeys de caixa, StockMap e até 3 lojas.',
    199.90,
    'BRL',
    'monthly',
    true
  ),
  (
    'enterprise',
    'Enterprise',
    'Dashboard, relatórios, CSV de estoque e lojas ilimitadas.',
    499.90,
    'BRL',
    'monthly',
    true
  )
ON CONFLICT (slug)
DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  amount = EXCLUDED.amount,
  currency = EXCLUDED.currency,
  billing_interval = EXCLUDED.billing_interval,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- Deactivate legacy/junk catalog rows (e.g. name=a) outside the seeded slugs.
UPDATE public.plans
SET
  is_active = false,
  updated_at = now()
WHERE slug IS NULL
   OR slug NOT IN ('essencial', 'profissional', 'enterprise');

-- Public visitor checkout + post-payment onboarding (no login required).
-- Complements (does not alter) migration 20260918120000_saas_plans_seed_mercadopago_assinaturas.sql.

-- ---------------------------------------------------------------------------
-- Table: checkout_sessions — public visitor checkout intent, keyed by
-- client_mutation_id (idempotency anchor). One row per hosted-checkout start.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.checkout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_mutation_id uuid NOT NULL UNIQUE,
  plan_id uuid NOT NULL REFERENCES public.plans (id) ON DELETE RESTRICT,
  payer_email text NOT NULL,
  -- Session status: pending | onboarded | failed
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'onboarded', 'failed')),
  -- Onboarding state: null until MP confirms; set exactly once (append-only)
  onboarding_status text
    CHECK (onboarding_status IS NULL OR onboarding_status IN ('completed', 'failed')),
  onboarding_organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL,
  onboarding_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  onboarding_subscription_id uuid REFERENCES public.subscriptions (id) ON DELETE SET NULL,
  onboarding_email_sent_at timestamptz,
  onboarding_completed_at timestamptz,
  onboarding_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.checkout_sessions IS
  'Public visitor checkout intent for SaaS subscription. Pre-payment row: no account exists yet. Onboarding state columns are set exactly once after MP webhook confirmation.';

CREATE INDEX IF NOT EXISTS checkout_sessions_payer_email_idx
  ON public.checkout_sessions (payer_email, created_at DESC);

CREATE INDEX IF NOT EXISTS checkout_sessions_plan_idx
  ON public.checkout_sessions (plan_id);

DROP TRIGGER IF EXISTS checkout_sessions_set_updated_at ON public.checkout_sessions;
CREATE TRIGGER checkout_sessions_set_updated_at
  BEFORE UPDATE ON public.checkout_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.checkout_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS checkout_sessions_deny ON public.checkout_sessions;
CREATE POLICY checkout_sessions_deny
  ON public.checkout_sessions
  FOR ALL TO PUBLIC
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.checkout_sessions FROM PUBLIC;
REVOKE ALL ON TABLE public.checkout_sessions FROM anon;
REVOKE ALL ON TABLE public.checkout_sessions FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.checkout_sessions TO service_role;

-- ---------------------------------------------------------------------------
-- RPC: mark a session onboarded (append-only, idempotent). service_role only.
-- The unique idempotency guarantee is checkout_sessions.client_mutation_id
-- (row-level, created pre-payment); this RPC only flips the same row forward.
-- Returns onboarding_status='completed' with replay=true when already done.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_checkout_session_onboarded(
  p_client_mutation_id uuid,
  p_organization_id uuid,
  p_user_id uuid,
  p_subscription_id uuid,
  p_onboarding_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_session public.checkout_sessions%ROWTYPE;
BEGIN
  IF p_client_mutation_id IS NULL THEN
    RAISE EXCEPTION 'checkout_session_mutation_id_required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_session
  FROM public.checkout_sessions
  WHERE client_mutation_id = p_client_mutation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'checkout_session_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_session.onboarding_status = 'completed' THEN
    RETURN jsonb_build_object(
      'replay', true,
      'client_mutation_id', p_client_mutation_id,
      'onboarding_status', 'completed',
      'organization_id', v_session.onboarding_organization_id,
      'user_id', v_session.onboarding_user_id,
      'subscription_id', v_session.onboarding_subscription_id
    );
  END IF;

  UPDATE public.checkout_sessions
  SET
    status = CASE
      WHEN p_onboarding_error IS NULL THEN 'onboarded'
      ELSE 'failed'
    END,
    onboarding_status = CASE
      WHEN p_onboarding_error IS NULL THEN 'completed'
      ELSE 'failed'
    END,
    onboarding_organization_id = p_organization_id,
    onboarding_user_id = p_user_id,
    onboarding_subscription_id = p_subscription_id,
    onboarding_error = p_onboarding_error,
    onboarding_completed_at = CASE
      WHEN p_onboarding_error IS NULL THEN now()
      ELSE NULL
    END,
    updated_at = now()
  WHERE client_mutation_id = p_client_mutation_id;

  RETURN jsonb_build_object(
    'replay', false,
    'client_mutation_id', p_client_mutation_id,
    'onboarding_status', CASE
      WHEN p_onboarding_error IS NULL THEN 'completed'
      ELSE 'failed'
    END,
    'organization_id', p_organization_id,
    'user_id', p_user_id,
    'subscription_id', p_subscription_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_checkout_session_onboarded(
  uuid, uuid, uuid, uuid, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_checkout_session_onboarded(
  uuid, uuid, uuid, uuid, text
) FROM anon;
REVOKE ALL ON FUNCTION public.mark_checkout_session_onboarded(
  uuid, uuid, uuid, uuid, text
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_checkout_session_onboarded(
  uuid, uuid, uuid, uuid, text
) TO service_role;

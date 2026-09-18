-- Public checkout onboarding claim/lease and Mercado Pago reconciliation.
-- This migration is intentionally separate from the already-applied
-- 20260918160000_public_checkout_sessions.sql.

ALTER TABLE public.checkout_sessions
  ADD COLUMN IF NOT EXISTS mp_preapproval_id text,
  ADD COLUMN IF NOT EXISTS onboarding_claim_token uuid,
  ADD COLUMN IF NOT EXISTS onboarding_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_attempt_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.checkout_sessions
  DROP CONSTRAINT IF EXISTS checkout_sessions_onboarding_status_check;

ALTER TABLE public.checkout_sessions
  ADD CONSTRAINT checkout_sessions_onboarding_status_check
  CHECK (
    onboarding_status IS NULL
    OR onboarding_status IN ('in_progress', 'completed', 'failed')
  );

ALTER TABLE public.checkout_sessions
  DROP CONSTRAINT IF EXISTS checkout_sessions_onboarding_attempt_count_check;

ALTER TABLE public.checkout_sessions
  ADD CONSTRAINT checkout_sessions_onboarding_attempt_count_check
  CHECK (onboarding_attempt_count >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS checkout_sessions_mp_preapproval_unique_idx
  ON public.checkout_sessions (mp_preapproval_id)
  WHERE mp_preapproval_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS checkout_sessions_onboarding_resolution_idx
  ON public.checkout_sessions (plan_id, lower(payer_email), created_at DESC)
  WHERE status IN ('pending', 'failed')
    AND (
      onboarding_status IS NULL
      OR onboarding_status IN ('in_progress', 'failed')
    );

CREATE INDEX IF NOT EXISTS checkout_sessions_onboarding_claimed_idx
  ON public.checkout_sessions (onboarding_claimed_at)
  WHERE onboarding_status = 'in_progress';

COMMENT ON COLUMN public.checkout_sessions.mp_preapproval_id IS
  'Mercado Pago preapproval linked to this public checkout session.';

COMMENT ON COLUMN public.checkout_sessions.onboarding_claim_token IS
  'Opaque lease token held by the webhook currently provisioning this session.';

COMMENT ON COLUMN public.checkout_sessions.onboarding_claimed_at IS
  'UTC timestamp at which the current onboarding lease was acquired.';

COMMENT ON COLUMN public.checkout_sessions.onboarding_attempt_count IS
  'Number of onboarding claims, including retries after an expired lease.';

CREATE OR REPLACE FUNCTION public.claim_checkout_session_onboarding(
  p_client_mutation_id uuid,
  p_preapproval_id text,
  p_claim_token uuid,
  p_lease_seconds integer DEFAULT 900
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_session public.checkout_sessions%ROWTYPE;
  v_preapproval_id text;
BEGIN
  IF p_client_mutation_id IS NULL THEN
    RAISE EXCEPTION 'checkout_session_mutation_id_required'
      USING ERRCODE = '22023';
  END IF;

  v_preapproval_id := NULLIF(btrim(coalesce(p_preapproval_id, '')), '');
  IF v_preapproval_id IS NULL THEN
    RAISE EXCEPTION 'checkout_session_preapproval_id_required'
      USING ERRCODE = '22023';
  END IF;

  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'checkout_session_claim_token_required'
      USING ERRCODE = '22023';
  END IF;

  IF p_lease_seconds < 60 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'checkout_session_invalid_lease'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_session
  FROM public.checkout_sessions
  WHERE client_mutation_id = p_client_mutation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'checkout_session_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_session.mp_preapproval_id IS NOT NULL
    AND v_session.mp_preapproval_id IS DISTINCT FROM v_preapproval_id
  THEN
    RETURN jsonb_build_object(
      'status', 'conflict',
      'replay', false,
      'reason', 'preapproval_already_bound'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.checkout_sessions other
    WHERE other.mp_preapproval_id = v_preapproval_id
      AND other.client_mutation_id IS DISTINCT FROM p_client_mutation_id
  ) THEN
    RETURN jsonb_build_object(
      'status', 'conflict',
      'replay', false,
      'reason', 'preapproval_bound_to_other_session'
    );
  END IF;

  IF v_session.onboarding_status = 'completed' THEN
    RETURN jsonb_build_object(
      'status', 'completed',
      'replay', true,
      'client_mutation_id', p_client_mutation_id,
      'organization_id', v_session.onboarding_organization_id,
      'user_id', v_session.onboarding_user_id,
      'subscription_id', v_session.onboarding_subscription_id,
      'email_sent', v_session.onboarding_email_sent_at IS NOT NULL,
      'mp_preapproval_id', v_session.mp_preapproval_id
    );
  END IF;

  IF v_session.onboarding_status = 'in_progress'
    AND v_session.onboarding_claimed_at IS NOT NULL
    AND v_session.onboarding_claimed_at > now() - make_interval(secs => p_lease_seconds)
  THEN
    RETURN jsonb_build_object(
      'status', 'busy',
      'replay', false,
      'client_mutation_id', p_client_mutation_id
    );
  END IF;

  UPDATE public.checkout_sessions
  SET
    mp_preapproval_id = coalesce(mp_preapproval_id, v_preapproval_id),
    onboarding_status = 'in_progress',
    onboarding_claim_token = p_claim_token,
    onboarding_claimed_at = now(),
    onboarding_attempt_count = onboarding_attempt_count + 1,
    onboarding_error = NULL,
    status = 'pending',
    updated_at = now()
  WHERE client_mutation_id = p_client_mutation_id
  RETURNING * INTO v_session;

  RETURN jsonb_build_object(
    'status', 'claimed',
    'replay', false,
    'client_mutation_id', p_client_mutation_id,
    'organization_id', v_session.onboarding_organization_id,
    'user_id', v_session.onboarding_user_id,
    'subscription_id', v_session.onboarding_subscription_id,
    'email_sent', v_session.onboarding_email_sent_at IS NOT NULL,
    'mp_preapproval_id', v_session.mp_preapproval_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_checkout_session_onboarding(
  p_client_mutation_id uuid,
  p_claim_token uuid,
  p_organization_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_subscription_id uuid DEFAULT NULL,
  p_email_sent boolean DEFAULT false,
  p_complete boolean DEFAULT false,
  p_onboarding_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_session public.checkout_sessions%ROWTYPE;
  v_organization_id uuid;
  v_user_id uuid;
  v_subscription_id uuid;
  v_email_sent_at timestamptz;
BEGIN
  IF p_client_mutation_id IS NULL THEN
    RAISE EXCEPTION 'checkout_session_mutation_id_required'
      USING ERRCODE = '22023';
  END IF;

  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'checkout_session_claim_token_required'
      USING ERRCODE = '22023';
  END IF;

  IF p_complete AND p_onboarding_error IS NOT NULL THEN
    RAISE EXCEPTION 'checkout_session_completion_error_conflict'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_session
  FROM public.checkout_sessions
  WHERE client_mutation_id = p_client_mutation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'checkout_session_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_session.onboarding_status = 'completed' THEN
    RETURN jsonb_build_object(
      'status', 'completed',
      'replay', true,
      'client_mutation_id', p_client_mutation_id,
      'organization_id', v_session.onboarding_organization_id,
      'user_id', v_session.onboarding_user_id,
      'subscription_id', v_session.onboarding_subscription_id,
      'email_sent', v_session.onboarding_email_sent_at IS NOT NULL
    );
  END IF;

  IF v_session.onboarding_status IS DISTINCT FROM 'in_progress'
    OR v_session.onboarding_claim_token IS DISTINCT FROM p_claim_token
  THEN
    RETURN jsonb_build_object(
      'status', 'busy',
      'replay', false,
      'client_mutation_id', p_client_mutation_id
    );
  END IF;

  v_organization_id := coalesce(p_organization_id, v_session.onboarding_organization_id);
  v_user_id := coalesce(p_user_id, v_session.onboarding_user_id);
  v_subscription_id := coalesce(p_subscription_id, v_session.onboarding_subscription_id);
  v_email_sent_at := CASE
    WHEN p_email_sent THEN coalesce(v_session.onboarding_email_sent_at, now())
    ELSE v_session.onboarding_email_sent_at
  END;

  IF p_complete AND (
    v_organization_id IS NULL
    OR v_user_id IS NULL
    OR v_subscription_id IS NULL
    OR v_email_sent_at IS NULL
  ) THEN
    RAISE EXCEPTION 'checkout_session_incomplete'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.checkout_sessions
  SET
    onboarding_organization_id = v_organization_id,
    onboarding_user_id = v_user_id,
    onboarding_subscription_id = v_subscription_id,
    onboarding_email_sent_at = v_email_sent_at,
    onboarding_status = CASE
      WHEN p_complete THEN 'completed'
      WHEN p_onboarding_error IS NOT NULL THEN 'failed'
      ELSE 'in_progress'
    END,
    status = CASE
      WHEN p_complete THEN 'onboarded'
      WHEN p_onboarding_error IS NOT NULL THEN 'failed'
      ELSE 'pending'
    END,
    onboarding_error = CASE
      WHEN p_complete THEN NULL
      WHEN p_onboarding_error IS NOT NULL THEN left(p_onboarding_error, 240)
      ELSE onboarding_error
    END,
    onboarding_completed_at = CASE
      WHEN p_complete THEN coalesce(onboarding_completed_at, now())
      ELSE onboarding_completed_at
    END,
    onboarding_claim_token = CASE
      WHEN p_complete OR p_onboarding_error IS NOT NULL THEN NULL
      ELSE p_claim_token
    END,
    onboarding_claimed_at = CASE
      WHEN p_complete OR p_onboarding_error IS NOT NULL THEN NULL
      ELSE onboarding_claimed_at
    END,
    updated_at = now()
  WHERE client_mutation_id = p_client_mutation_id;

  RETURN jsonb_build_object(
    'status', CASE
      WHEN p_complete THEN 'completed'
      WHEN p_onboarding_error IS NOT NULL THEN 'failed'
      ELSE 'in_progress'
    END,
    'replay', false,
    'client_mutation_id', p_client_mutation_id,
    'organization_id', v_organization_id,
    'user_id', v_user_id,
    'subscription_id', v_subscription_id,
    'email_sent', v_email_sent_at IS NOT NULL
  );
END;
$$;

-- Keep the original RPC safe for older application instances during rollout.
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
  WHERE client_mutation_id = p_client_mutation_id
  FOR UPDATE;

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
    onboarding_organization_id = coalesce(
      p_organization_id,
      onboarding_organization_id
    ),
    onboarding_user_id = coalesce(p_user_id, onboarding_user_id),
    onboarding_subscription_id = coalesce(
      p_subscription_id,
      onboarding_subscription_id
    ),
    onboarding_error = CASE
      WHEN p_onboarding_error IS NULL THEN NULL
      ELSE left(p_onboarding_error, 240)
    END,
    onboarding_completed_at = CASE
      WHEN p_onboarding_error IS NULL THEN coalesce(onboarding_completed_at, now())
      ELSE onboarding_completed_at
    END,
    onboarding_claim_token = NULL,
    onboarding_claimed_at = NULL,
    updated_at = now()
  WHERE client_mutation_id = p_client_mutation_id;

  RETURN jsonb_build_object(
    'replay', false,
    'client_mutation_id', p_client_mutation_id,
    'onboarding_status', CASE
      WHEN p_onboarding_error IS NULL THEN 'completed'
      ELSE 'failed'
    END,
    'organization_id', coalesce(p_organization_id, v_session.onboarding_organization_id),
    'user_id', coalesce(p_user_id, v_session.onboarding_user_id),
    'subscription_id', coalesce(p_subscription_id, v_session.onboarding_subscription_id)
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

REVOKE ALL ON FUNCTION public.claim_checkout_session_onboarding(
  uuid, text, uuid, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_checkout_session_onboarding(
  uuid, text, uuid, integer
) FROM anon;
REVOKE ALL ON FUNCTION public.claim_checkout_session_onboarding(
  uuid, text, uuid, integer
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_checkout_session_onboarding(
  uuid, text, uuid, integer
) TO service_role;

REVOKE ALL ON FUNCTION public.save_checkout_session_onboarding(
  uuid, uuid, uuid, uuid, uuid, boolean, boolean, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_checkout_session_onboarding(
  uuid, uuid, uuid, uuid, uuid, boolean, boolean, text
) FROM anon;
REVOKE ALL ON FUNCTION public.save_checkout_session_onboarding(
  uuid, uuid, uuid, uuid, uuid, boolean, boolean, text
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.save_checkout_session_onboarding(
  uuid, uuid, uuid, uuid, uuid, boolean, boolean, text
) TO service_role;

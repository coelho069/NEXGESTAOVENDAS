-- Platform SaaS admin domain (plans, subscriptions, platform_admins).
-- Compatible with current tenant subscription-access: subscriptions.org_id
-- and statuses active|trialing|past_due|expired|canceled|cancelled.
-- Tenant store_members.role never grants platform access.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'subscription_status'
  ) THEN
    CREATE TYPE public.subscription_status AS ENUM (
      'active',
      'trialing',
      'past_due',
      'expired',
      'canceled',
      'cancelled'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'subscription_billing_interval'
  ) THEN
    CREATE TYPE public.subscription_billing_interval AS ENUM (
      'monthly',
      'yearly'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  description text NOT NULL DEFAULT '',
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  currency char(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  billing_interval public.subscription_billing_interval NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES public.plans (id) ON DELETE RESTRICT,
  status public.subscription_status NOT NULL DEFAULT 'active',
  contracted_amount numeric(12, 2) NOT NULL CHECK (contracted_amount >= 0),
  currency char(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  period_start date NOT NULL,
  period_end date NOT NULL,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_period_valid CHECK (period_end > period_start),
  CONSTRAINT subscriptions_cancelled_state CHECK (
    (
      status IN ('canceled', 'cancelled')
      AND cancelled_at IS NOT NULL
    )
    OR (
      status NOT IN ('canceled', 'cancelled')
      AND cancelled_at IS NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_open_per_org_idx
  ON public.subscriptions (org_id)
  WHERE status IN ('active', 'trialing', 'past_due');

CREATE INDEX IF NOT EXISTS subscriptions_org_updated_idx
  ON public.subscriptions (org_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS subscriptions_org_created_idx
  ON public.subscriptions (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS subscriptions_period_end_idx
  ON public.subscriptions (period_end);

CREATE INDEX IF NOT EXISTS subscriptions_plan_idx
  ON public.subscriptions (plan_id);

DROP TRIGGER IF EXISTS platform_admins_set_updated_at ON public.platform_admins;
CREATE TRIGGER platform_admins_set_updated_at
  BEFORE UPDATE ON public.platform_admins
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS plans_set_updated_at ON public.plans;
CREATE TRIGGER plans_set_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS subscriptions_set_updated_at ON public.subscriptions;
CREATE TRIGGER subscriptions_set_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins pa
    WHERE (SELECT auth.uid()) IS NOT NULL
      AND pa.user_id = (SELECT auth.uid())
      AND pa.is_active IS TRUE
  );
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_platform_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.platform_admins FROM PUBLIC;
REVOKE ALL ON TABLE public.platform_admins FROM anon;
REVOKE ALL ON TABLE public.platform_admins FROM authenticated;
GRANT SELECT ON TABLE public.platform_admins TO authenticated;

REVOKE ALL ON TABLE public.plans FROM PUBLIC;
REVOKE ALL ON TABLE public.plans FROM anon;
REVOKE ALL ON TABLE public.plans FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.plans TO authenticated;

REVOKE ALL ON TABLE public.subscriptions FROM PUBLIC;
REVOKE ALL ON TABLE public.subscriptions FROM anon;
REVOKE ALL ON TABLE public.subscriptions FROM authenticated;
-- Historical records: cancel via UPDATE only; no physical DELETE for authenticated.
GRANT SELECT, INSERT, UPDATE ON TABLE public.subscriptions TO authenticated;
REVOKE DELETE ON TABLE public.subscriptions FROM authenticated;

DROP POLICY IF EXISTS platform_admins_select_self ON public.platform_admins;
CREATE POLICY platform_admins_select_self
  ON public.platform_admins
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND is_active IS TRUE
  );

DROP POLICY IF EXISTS plans_select_platform_admin ON public.plans;
CREATE POLICY plans_select_platform_admin
  ON public.plans
  FOR SELECT TO authenticated
  USING (public.is_platform_admin() IS TRUE);

DROP POLICY IF EXISTS plans_insert_platform_admin ON public.plans;
CREATE POLICY plans_insert_platform_admin
  ON public.plans
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin() IS TRUE);

DROP POLICY IF EXISTS plans_update_platform_admin ON public.plans;
CREATE POLICY plans_update_platform_admin
  ON public.plans
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin() IS TRUE)
  WITH CHECK (public.is_platform_admin() IS TRUE);

DROP POLICY IF EXISTS plans_delete_platform_admin ON public.plans;
CREATE POLICY plans_delete_platform_admin
  ON public.plans
  FOR DELETE TO authenticated
  USING (public.is_platform_admin() IS TRUE);

DROP POLICY IF EXISTS subscriptions_select_platform_admin ON public.subscriptions;
CREATE POLICY subscriptions_select_platform_admin
  ON public.subscriptions
  FOR SELECT TO authenticated
  USING (public.is_platform_admin() IS TRUE);

-- Tenant PDV/dashboard subscription-access reads own org status only.
-- Uses the same org membership helpers as other tenant SELECT policies.
-- Write access remains platform-admin-only (INSERT/UPDATE below; DELETE revoked).
DROP POLICY IF EXISTS subscriptions_select_tenant ON public.subscriptions;
CREATE POLICY subscriptions_select_tenant
  ON public.subscriptions
  FOR SELECT TO authenticated
  USING (
    public.user_has_org_membership() IS TRUE
    AND org_id = public.current_user_org_id()
  );

DROP POLICY IF EXISTS subscriptions_insert_platform_admin ON public.subscriptions;
CREATE POLICY subscriptions_insert_platform_admin
  ON public.subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin() IS TRUE);

DROP POLICY IF EXISTS subscriptions_update_platform_admin ON public.subscriptions;
CREATE POLICY subscriptions_update_platform_admin
  ON public.subscriptions
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin() IS TRUE)
  WITH CHECK (public.is_platform_admin() IS TRUE);

DROP POLICY IF EXISTS subscriptions_delete_platform_admin ON public.subscriptions;

-- Tenant users keep existing org/store scope; platform admins may read globally.
DROP POLICY IF EXISTS organizations_select ON public.organizations;
CREATE POLICY organizations_select
  ON public.organizations
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin() IS TRUE
    OR (
      public.user_has_org_membership() IS TRUE
      AND id = public.current_user_org_id()
    )
  );

DROP POLICY IF EXISTS stores_select ON public.stores;
CREATE POLICY stores_select
  ON public.stores
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin() IS TRUE
    OR public.user_has_store_access(id) IS TRUE
  );

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin() IS TRUE
    OR (
      public.user_has_org_membership() IS TRUE
      AND (
        id = (SELECT auth.uid())
        OR org_id = public.current_user_org_id()
      )
    )
  );

DROP POLICY IF EXISTS store_members_select ON public.store_members;
CREATE POLICY store_members_select
  ON public.store_members
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin() IS TRUE
    OR public.user_has_store_access(store_id) IS TRUE
  );

CREATE OR REPLACE FUNCTION public.prevent_delete_plan_in_use()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.plan_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'plan_in_use'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS plans_prevent_delete_in_use ON public.plans;
CREATE TRIGGER plans_prevent_delete_in_use
  BEFORE DELETE ON public.plans
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_delete_plan_in_use();

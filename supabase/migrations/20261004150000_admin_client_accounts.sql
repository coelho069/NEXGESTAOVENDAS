-- Admin-created client accounts + e-mail invitations (Gmail).
--
-- Minimal data extension: there is no existing table that tracks the
-- authentication-state / invitation-state lifecycle of a client login, only
-- `profiles` (tenant data) and `subscriptions` (financial state).
--
-- Invariants:
--   * This table NEVER changes subscription/payment state. It only records who
--     the platform admin provisioned and how far the invitation progressed.
--   * No activation token / password material is stored. Only timestamps.
--   * Tenant roles are NOT granted here: store_members remains the single
--     source of truth for tenant permissions and platform_admins is untouched.
--   * Access is restricted to active platform admins; clients can never read
--     or write this table.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'client_account_status'
  ) THEN
    CREATE TYPE public.client_account_status AS ENUM (
      'created',
      'invite_pending',
      'invite_sent',
      'invite_expired',
      'activated',
      'invite_failed',
      'suspended'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'client_account_event_type'
  ) THEN
    CREATE TYPE public.client_account_event_type AS ENUM (
      'account_created',
      'invite_sent',
      'invite_resent',
      'invite_failed',
      'account_activated',
      'account_suspended',
      'account_reactivated'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.client_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  subscription_id uuid REFERENCES public.subscriptions (id) ON DELETE SET NULL,
  email text NOT NULL CHECK (position('@' IN email) > 1),
-- Append-only audit trail. Payload holds identifiers and event codes only —
-- never passwords, tokens or full activation links.
CREATE TABLE IF NOT EXISTS public.client_account_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_account_id uuid NOT NULL REFERENCES public.client_accounts (id) ON DELETE CASCADE,
  event_type public.client_account_event_type NOT NULL,
  actor_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  error_code text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_account_events_account_idx
  ON public.client_account_events (client_account_id, created_at DESC);

DROP TRIGGER IF EXISTS client_accounts_set_updated_at ON public.client_accounts;
CREATE TRIGGER client_accounts_set_updated_at
  BEFORE UPDATE ON public.client_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Audit trail is immutable: corrections are new rows, never UPDATEs.
CREATE OR REPLACE FUNCTION public.client_account_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'client_account_events_append_only'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS client_account_events_no_update ON public.client_account_events;
CREATE TRIGGER client_account_events_no_update
  BEFORE UPDATE OR DELETE ON public.client_account_events
  FOR EACH ROW
  EXECUTE FUNCTION public.client_account_events_append_only();
  full_name text NOT NULL CHECK (btrim(full_name) <> ''),
  company_name text NOT NULL DEFAULT '',
  status public.client_account_status NOT NULL DEFAULT 'created',
  last_error text NOT NULL DEFAULT '',
-- Platform admins read/write; tenants never see this table.
-- Provisioning itself runs through the service-role client, which bypasses RLS.
DROP POLICY IF EXISTS client_accounts_select_platform_admin ON public.client_accounts;
CREATE POLICY client_accounts_select_platform_admin
  ON public.client_accounts
  FOR SELECT TO authenticated
  USING (public.is_platform_admin() IS TRUE);

DROP POLICY IF EXISTS client_accounts_update_platform_admin ON public.client_accounts;
CREATE POLICY client_accounts_update_platform_admin
  ON public.client_accounts
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin() IS TRUE)
  WITH CHECK (public.is_platform_admin() IS TRUE);

-- No INSERT/DELETE policies: rows are created by the server-side provisioning
-- path only (service role), and are never deleted from the client surface.

DROP POLICY IF EXISTS client_account_events_select_platform_admin ON public.client_account_events;
CREATE POLICY client_account_events_select_platform_admin
  ON public.client_account_events
  FOR SELECT TO authenticated
  USING (public.is_platform_admin() IS TRUE);

DROP POLICY IF EXISTS client_account_events_insert_platform_admin ON public.client_account_events;
CREATE POLICY client_account_events_insert_platform_admin
  ON public.client_account_events
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin() IS TRUE);
  invite_sent_at timestamptz,
  invite_expires_at timestamptz,
  activated_at timestamptz,
  suspended_at timestamptz,
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive single account per e-mail: idempotency anchor for the
-- create-account flow (duplicate requests can never provision twice).
CREATE UNIQUE INDEX IF NOT EXISTS client_accounts_email_unique_idx
  ON public.client_accounts (lower(email));

-- One provisioned login per auth user.
CREATE UNIQUE INDEX IF NOT EXISTS client_accounts_user_unique_idx
  ON public.client_accounts (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS client_accounts_org_idx ON public.client_accounts (org_id);
CREATE INDEX IF NOT EXISTS client_accounts_subscription_idx
  ON public.client_accounts (subscription_id)
  WHERE subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_accounts_status_idx ON public.client_accounts (status);
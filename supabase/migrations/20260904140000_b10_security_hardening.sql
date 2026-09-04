-- Bloqueador 10 — production security hardening follow-up.
-- Local-only apply. Does not change remote projects.

-- 1) Fixed search_path for every application SECURITY DEFINER function.
-- Extension helpers such as dblink_connect_u are left untouched.
DO $$
DECLARE
  v_function regprocedure;
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prosecdef
      AND p.proname NOT LIKE 'dblink%'
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path = pg_catalog, public, pg_temp',
      v_function
    );
  END LOOP;
END;
$$;

-- 2) Deny-by-default for newly created tables in public.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- 3) Profiles are self-readable only. Org-wide directory reads are not required
-- by the application (session/profile load uses auth.uid()).
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

-- 4) Discount helper remains executable by authenticated (SECURITY DEFINER +
-- store membership checks). PUBLIC/anon stay revoked from earlier migrations.

-- 5) Defense in depth: keep internal operational tables closed to Data API roles.
REVOKE ALL ON TABLE public.integration_outbox FROM anon, authenticated;
REVOKE ALL ON TABLE public.payment_provider_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.sale_idempotency_keys FROM anon, authenticated;

-- 6) Sequences remain closed to browser roles.
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

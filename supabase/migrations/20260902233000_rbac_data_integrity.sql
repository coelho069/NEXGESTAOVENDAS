-- RBAC data-integrity follow-up. Additive only: no columns, no behavior
-- changes for legitimate flows. Complements 20260902150536 (hardening),
-- 20260902201000 (membership authority) and 20260902225832 (catalog scope):
--
--   1. Authorization is store_members.role per (auth.uid(), store_id).
--      profiles.org_id / profiles.default_role are provisioning data; this
--      migration makes them non-driftable for app roles even if a future
--      policy mistake re-grants UPDATE on public.profiles.
--   2. A membership must always reference a store of the SAME organization;
--      the composite FK makes cross-org membership impossible at data level.

-- 1. Provisioning guard on profiles (app roles only).
--    SECURITY INVOKER on purpose: the guard evaluates OLD/NEW only, and
--    current_user distinguishes app roles (authenticated) from privileged
--    provisioning roles (service_role / postgres), which remain allowed.
CREATE OR REPLACE FUNCTION public.profiles_provisioning_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF current_user = 'authenticated'
    AND (
      NEW.org_id IS DISTINCT FROM OLD.org_id
      OR NEW.default_role IS DISTINCT FROM OLD.default_role
    ) THEN
    RAISE EXCEPTION 'profiles_provisioning_columns_immutable'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.profiles_provisioning_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profiles_provisioning_guard() FROM anon;
REVOKE ALL ON FUNCTION public.profiles_provisioning_guard() FROM authenticated;

DROP TRIGGER IF EXISTS profiles_provisioning_guard ON public.profiles;
CREATE TRIGGER profiles_provisioning_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_provisioning_guard();

-- 2. Membership/store organization integrity.
-- Required unique pair for the composite foreign key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stores_id_org
  ON public.stores (id, org_id);

-- Fail fast with a clear error if legacy rows already violate the rule,
-- mirroring the guard pattern used by the earlier hardening migrations.
DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.store_members sm
  LEFT JOIN public.stores s
    ON s.id = sm.store_id
   AND s.org_id = sm.org_id
  WHERE s.id IS NULL;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'legacy_store_member_org_mismatch: % row(s)', v_bad
      USING ERRCODE = '23514';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'fk_store_members_store_same_org'
      AND conrelid = 'public.store_members'::regclass
  ) THEN
    ALTER TABLE public.store_members
      ADD CONSTRAINT fk_store_members_store_same_org
      FOREIGN KEY (store_id, org_id)
      REFERENCES public.stores (id, org_id)
      ON DELETE CASCADE;
  END IF;
END;
$$;

-- Restore org-scoped customer writes for PDV/cadastro.
-- SELECT stayed after production hardening; INSERT/UPDATE return for
-- authenticated org members. DELETE stays revoked (no exclusão no MVP).

GRANT INSERT, UPDATE ON TABLE public.customers TO authenticated;

DROP POLICY IF EXISTS customers_insert ON public.customers;
CREATE POLICY customers_insert ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_org_membership() IS TRUE
    AND org_id = public.current_user_org_id()
  );

DROP POLICY IF EXISTS customers_update ON public.customers;
CREATE POLICY customers_update ON public.customers
  FOR UPDATE TO authenticated
  USING (
    public.user_has_org_membership() IS TRUE
    AND org_id = public.current_user_org_id()
  )
  WITH CHECK (
    public.user_has_org_membership() IS TRUE
    AND org_id = public.current_user_org_id()
  );

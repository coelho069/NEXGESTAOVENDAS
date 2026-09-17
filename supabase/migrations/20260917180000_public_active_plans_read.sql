-- Public read of active subscription plans for the marketing homepage (Sprint 4a).
-- Exposes only is_active rows; admin write paths remain platform-admin-only.

GRANT SELECT ON TABLE public.plans TO anon;

DROP POLICY IF EXISTS plans_select_public_active ON public.plans;
CREATE POLICY plans_select_public_active
  ON public.plans
  FOR SELECT TO anon, authenticated
  USING (is_active IS TRUE);

-- ============================================================================
-- Performance de RLS: envolve helpers sem argumento de linha em (SELECT ...)
-- para que o Postgres avalie uma vez por statement (initPlan) em vez de por
-- linha. Semântica idêntica: as funções são STABLE e o texto das condições
-- foi copiado das migrations originais, mudando só a chamada do helper.
--
-- Alterados (texto original em 20260910160000 e 20260903183303):
--   plans_select/insert/update/delete_platform_admin
--   subscriptions_select_platform_admin, subscriptions_select_tenant,
--   subscriptions_insert_platform_admin, subscriptions_update_platform_admin
--   organizations_select, stores_select, profiles_select_own,
--   store_members_select (versão vigente de 20260910160000)
--   products_select_active, customers_select (versão de 20260903183303)
--
-- Não alterados: user_has_store_access(store_id/id) depende da linha, então
-- não pode ser envolvido; customers_insert/update são tratados em
-- 20261015120000.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- plans (20260910160000)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS plans_select_platform_admin ON public.plans;
CREATE POLICY plans_select_platform_admin
  ON public.plans
  FOR SELECT TO authenticated
  USING ((SELECT public.is_platform_admin()) IS TRUE);

DROP POLICY IF EXISTS plans_insert_platform_admin ON public.plans;
CREATE POLICY plans_insert_platform_admin
  ON public.plans
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_platform_admin()) IS TRUE);

DROP POLICY IF EXISTS plans_update_platform_admin ON public.plans;
CREATE POLICY plans_update_platform_admin
  ON public.plans
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_platform_admin()) IS TRUE)
  WITH CHECK ((SELECT public.is_platform_admin()) IS TRUE);

DROP POLICY IF EXISTS plans_delete_platform_admin ON public.plans;
CREATE POLICY plans_delete_platform_admin
  ON public.plans
  FOR DELETE TO authenticated
  USING ((SELECT public.is_platform_admin()) IS TRUE);

-- ---------------------------------------------------------------------------
-- subscriptions (20260910160000)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS subscriptions_select_platform_admin ON public.subscriptions;
CREATE POLICY subscriptions_select_platform_admin
  ON public.subscriptions
  FOR SELECT TO authenticated
  USING ((SELECT public.is_platform_admin()) IS TRUE);

DROP POLICY IF EXISTS subscriptions_select_tenant ON public.subscriptions;
CREATE POLICY subscriptions_select_tenant
  ON public.subscriptions
  FOR SELECT TO authenticated
  USING (
    (SELECT public.user_has_org_membership()) IS TRUE
    AND org_id = (SELECT public.current_user_org_id())
  );

DROP POLICY IF EXISTS subscriptions_insert_platform_admin ON public.subscriptions;
CREATE POLICY subscriptions_insert_platform_admin
  ON public.subscriptions
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_platform_admin()) IS TRUE);

DROP POLICY IF EXISTS subscriptions_update_platform_admin ON public.subscriptions;
CREATE POLICY subscriptions_update_platform_admin
  ON public.subscriptions
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_platform_admin()) IS TRUE)
  WITH CHECK ((SELECT public.is_platform_admin()) IS TRUE);

-- ---------------------------------------------------------------------------
-- organizations / stores / profiles / store_members (versão de 20260910160000)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS organizations_select ON public.organizations;
CREATE POLICY organizations_select
  ON public.organizations
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_platform_admin()) IS TRUE
    OR (
      (SELECT public.user_has_org_membership()) IS TRUE
      AND id = (SELECT public.current_user_org_id())
    )
  );

DROP POLICY IF EXISTS stores_select ON public.stores;
CREATE POLICY stores_select
  ON public.stores
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_platform_admin()) IS TRUE
    OR public.user_has_store_access(id) IS TRUE
  );

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_platform_admin()) IS TRUE
    OR (
      (SELECT public.user_has_org_membership()) IS TRUE
      AND (
        id = (SELECT auth.uid())
        OR org_id = (SELECT public.current_user_org_id())
      )
    )
  );

DROP POLICY IF EXISTS store_members_select ON public.store_members;
CREATE POLICY store_members_select
  ON public.store_members
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_platform_admin()) IS TRUE
    OR public.user_has_store_access(store_id) IS TRUE
  );

-- ---------------------------------------------------------------------------
-- products / customers SELECT (versão de 20260903183303)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS products_select_active ON public.products;
CREATE POLICY products_select_active ON public.products
  FOR SELECT TO authenticated
  USING (
    (SELECT public.user_has_org_membership()) IS TRUE
    AND org_id = (SELECT public.current_user_org_id())
    AND is_active IS TRUE
  );

DROP POLICY IF EXISTS customers_select ON public.customers;
CREATE POLICY customers_select ON public.customers
  FOR SELECT TO authenticated
  USING (
    (SELECT public.user_has_org_membership()) IS TRUE
    AND org_id = (SELECT public.current_user_org_id())
  );

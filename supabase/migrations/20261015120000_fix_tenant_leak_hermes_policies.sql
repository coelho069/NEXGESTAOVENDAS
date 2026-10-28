-- ============================================================================
-- Correção de vazamento entre tenants em customers/products.
--
-- Problema: as migrations do Hermes (20260925120000 e 20260925130000) criaram
-- policies com USING (true) / WITH CHECK sem vínculo a org_id para
-- `authenticated`. Policies permissivas são combinadas por OR, então qualquer
-- usuário logado lia e alterava clientes/produtos de todas as organizações.
--
-- Correção:
--   - remove todas as policies USING (true) e as de escrita sem org_id;
--   - recria INSERT/UPDATE de customers escopados por org_id do usuário,
--     preservando as validações de name/email já existentes;
--   - products: SELECT já é coberto por products_select_active (org + ativo,
--     da migration RBAC). Escrita em products é RPC-only desde
--     20260902225832 (INSERT/UPDATE/DELETE revogados de authenticated), então
--     as policies de escrita do Hermes eram inertes e são apenas removidas.
--
-- Não altera migrations anteriores. Mantém o REVOKE DELETE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Remove as policies que vazam dados entre organizações
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "customers_select_authenticated" ON public.customers;
DROP POLICY IF EXISTS "customers_insert_authenticated" ON public.customers;
DROP POLICY IF EXISTS "customers_update_authenticated" ON public.customers;
DROP POLICY IF EXISTS "products_select_authenticated"  ON public.products;
DROP POLICY IF EXISTS "products_insert_authenticated"  ON public.products;
DROP POLICY IF EXISTS "products_update_authenticated"  ON public.products;

-- ---------------------------------------------------------------------------
-- 2. customers: INSERT/UPDATE escopados à organização do usuário.
--    Substituem as policies org-scoped de 20260917120000 (mesmo nome) para
--    que exista uma única policy por operação, com validação incluída.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS customers_insert ON public.customers;
CREATE POLICY customers_insert ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.user_has_org_membership()) IS TRUE
    AND org_id = (SELECT public.current_user_org_id())
    AND name IS NOT NULL AND length(btrim(name)) > 0
    AND (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  );

DROP POLICY IF EXISTS customers_update ON public.customers;
CREATE POLICY customers_update ON public.customers
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.user_has_org_membership()) IS TRUE
    AND org_id = (SELECT public.current_user_org_id())
  )
  WITH CHECK (
    (SELECT public.user_has_org_membership()) IS TRUE
    AND org_id = (SELECT public.current_user_org_id())
    AND name IS NOT NULL AND length(btrim(name)) > 0
    AND (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  );

-- ---------------------------------------------------------------------------
-- 3. Grants: anon sem acesso; authenticated só lê products (escrita via RPC).
--    Sem policy para anon, RLS já nega; o REVOKE é defesa em profundidade.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.customers, public.products FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.products FROM authenticated;

-- ---------------------------------------------------------------------------
-- 4. Blindagem: nenhuma role de aplicação apaga clientes/produtos.
-- ---------------------------------------------------------------------------
REVOKE DELETE ON public.customers FROM anon, authenticated;
REVOKE DELETE ON public.products  FROM anon, authenticated;

COMMENT ON POLICY customers_insert ON public.customers IS
  'Cadastro de cliente no balcão: mesma org do usuário, nome obrigatório e email válido quando informado.';
COMMENT ON POLICY customers_update ON public.customers IS
  'Edição de cliente: somente clientes da própria org; valores validados e org_id não pode mudar.';

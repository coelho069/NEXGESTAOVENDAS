-- ============================================================================
-- Etapa 3: Policies de escrita (INSERT/UPDATE) para o fluxo do Hermes/PDV.
-- Precondição: 20260925120000_hermes_chat_tables_rls.sql já aplicada.
-- Idempotente: pode ser reexecutado no SQL Editor sem efeitos colaterais.
--
-- Modelo de permissão:
--   - Operador de caixa (role `authenticated`): pode cadastrar/atualizar
--     produtos e clientes (rotina de balcão), mas NÃO apagar histórico.
--   - Role `anon`: nada de escrita (nem leitura — definido na Etapa 1).
--
-- Nota Supabase: PostgREST só executa INSERT/UPDATE se a role também tiver o
-- grant correspondente; no Supabase esses grants já existem por padrão.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- customers: INSERT + UPDATE para authenticated
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "customers_insert_authenticated" ON public.customers;
CREATE POLICY "customers_insert_authenticated"
  ON public.customers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    name IS NOT NULL AND length(btrim(name)) > 0
    AND (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  );

DROP POLICY IF EXISTS "customers_update_authenticated" ON public.customers;
CREATE POLICY "customers_update_authenticated"
  ON public.customers
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (
    name IS NOT NULL AND length(btrim(name)) > 0
    AND (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  );

-- ---------------------------------------------------------------------------
-- products: INSERT + UPDATE para authenticated
--   - unit_price >= 0 já é garantido por CHECK da tabela; a policy revalida
--     porque WITH CHECK de policy roda antes do CHECK de tabela.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "products_insert_authenticated" ON public.products;
CREATE POLICY "products_insert_authenticated"
  ON public.products
  FOR INSERT
  TO authenticated
  WITH CHECK (
    name IS NOT NULL AND length(btrim(name)) > 0
    AND unit_price >= 0
  );

DROP POLICY IF EXISTS "products_update_authenticated" ON public.products;
CREATE POLICY "products_update_authenticated"
  ON public.products
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (
    name IS NOT NULL AND length(btrim(name)) > 0
    AND unit_price >= 0
  );

-- ---------------------------------------------------------------------------
-- Blindagem: nenhuma role de aplicação apaga dados (sem DELETE policy).
-- Revoke explícito no Postgres "cru"; no Supabase é redundante mas inócuo.
-- ---------------------------------------------------------------------------
REVOKE DELETE ON public.customers FROM anon, authenticated;
REVOKE DELETE ON public.products  FROM anon, authenticated;

COMMENT ON POLICY "products_insert_authenticated" ON public.products IS
  'Cadastro de produto no balcão: nome obrigatório e preço não negativo.';
COMMENT ON POLICY "customers_insert_authenticated" ON public.customers IS
  'Cadastro de cliente no balcão: nome obrigatório e email válido quando informado.';

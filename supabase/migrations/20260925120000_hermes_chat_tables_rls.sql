-- ============================================================================
-- Manutenção emergencial: tabelas de suporte ao Chat do Hermes (NEX)
-- Corrige: 42P01 (relation does not exist) e 401 (RLS sem policy de SELECT).
-- Idempotente: pode ser reexecutado no SQL Editor sem efeitos colaterais.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabelas (IF NOT EXISTS elimina o 42P01 em execuções repetidas)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  email      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Email único quando informado (índice parcial: NULL nunca duplica)
CREATE UNIQUE INDEX IF NOT EXISTS customers_email_unique_idx
  ON public.customers (lower(email))
  WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.products (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  sku        text,
  barcode    text,
  unit_price numeric(12, 2) NOT NULL DEFAULT 0
             CHECK (unit_price >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- SKU e código de barras únicos quando informados (busca do PDV depende disso)
CREATE UNIQUE INDEX IF NOT EXISTS products_sku_unique_idx
  ON public.products (sku)
  WHERE sku IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_unique_idx
  ON public.products (barcode)
  WHERE barcode IS NOT NULL;

-- Busca rápida por nome/sku/barcode na tela de PDV
CREATE INDEX IF NOT EXISTS products_name_lower_idx
  ON public.products (lower(name));

-- ---------------------------------------------------------------------------
-- 2. RLS (o 401 acontece quando RLS está ativo e nenhuma policy autoriza
--    o SELECT — habilitar e criar as policies na mesma execução evita a
--    janela em que a tabela fica inacessível)
-- ---------------------------------------------------------------------------
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Remove políticas antigas para reconstruí-las de forma determinística
DROP POLICY IF EXISTS "customers_select_authenticated" ON public.customers;
DROP POLICY IF EXISTS "products_select_authenticated"  ON public.products;

-- SELECT liberado para qualquer usuário autenticado (role `authenticated`)
CREATE POLICY "customers_select_authenticated"
  ON public.customers
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "products_select_authenticated"
  ON public.products
  FOR SELECT
  TO authenticated
  USING (true);

-- ---------------------------------------------------------------------------
-- 3. Comentários
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.customers IS
  'Clientes do PDV. Leitura para authenticated; escrita controlada por policies futuras.';
COMMENT ON TABLE public.products IS
  'Produtos do PDV (sku/barcode/unit_price). Leitura para authenticated; escrita controlada por policies futuras.';

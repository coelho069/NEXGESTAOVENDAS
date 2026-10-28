-- Limite de desconto por cliente (valor em R$), editável no cadastro e impresso no recibo.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS discount_limit numeric(12,2);

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_discount_limit_nonnegative;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_discount_limit_nonnegative
  CHECK (discount_limit IS NULL OR discount_limit >= 0);

COMMENT ON COLUMN public.customers.discount_limit IS
  'Limite máximo de desconto permitido para o cliente (R$). NULL = sem limite específico além do papel.';

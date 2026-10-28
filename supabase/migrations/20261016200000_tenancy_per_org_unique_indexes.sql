-- Remediação C2 (P1): unicidade de SKU, código de barras e e-mail de cliente
-- passa a ser por organização, não global entre tenants.
--
-- Remove os índices globais criados em 20260925120000 (sem org_id). Eles
-- causavam colisão entre organizações e serviam de oráculo de existência
-- (422 vs 201) para códigos de outros tenants.
--
-- Unicidade por organização já existe para produtos:
--   - products: UNIQUE (org_id, sku)                 (20250901000002_core_schema)
--   - products: products_org_barcode_key              (20260903192557)
-- Para clientes não havia unicidade por organização; é criada abaixo.
--
-- Idempotente. Não altera migrations anteriores.

DROP INDEX IF EXISTS public.products_sku_unique_idx;
DROP INDEX IF EXISTS public.products_barcode_unique_idx;
DROP INDEX IF EXISTS public.customers_email_unique_idx;

-- Guarda: se já houver e-mail duplicado dentro de uma mesma organização, a
-- migration para com erro explícito em vez de criar índice inválido. O índice
-- global anterior impedia duplicidade, então em bancos onde ele foi criado este
-- bloco não encontra nada. Consulta de verificação para o owner está no relatório.
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM (
    SELECT org_id, lower(email)
    FROM public.customers
    WHERE email IS NOT NULL
    GROUP BY org_id, lower(email)
    HAVING count(*) > 1
  ) d;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'customers_email_duplicate_within_org: % grupos duplicados; resolver antes de aplicar', v_count
      USING ERRCODE = '23505';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS customers_org_email_unique_idx
  ON public.customers (org_id, lower(email))
  WHERE email IS NOT NULL;

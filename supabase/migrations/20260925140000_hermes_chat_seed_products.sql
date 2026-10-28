-- ============================================================================
-- Etapa 4: Seed de produtos de exemplo para testar o PDV/Chat do Hermes.
-- Precondição: Tabelas e RLS aplicadas.
-- Idempotente: ON CONFLICT (org_id, sku) DO UPDATE — pode reexecutar à vontade.
-- Valores realistas de balcão (BRL) para validar grid, busca e recibo.
-- ============================================================================

INSERT INTO public.organizations (id, name, slug)
VALUES ('11111111-1111-4111-8111-111111111111', 'Organização Demonstração', 'demo-org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.products (org_id, sku, name, barcode, unit_price) VALUES
  ('11111111-1111-4111-8111-111111111111', 'CAF-500',    'Café Torrado 500g',        '7890000000011', 19.90),
  ('11111111-1111-4111-8111-111111111111', 'LEI-001',    'Leite Integral 1L',        '7890000000028',  5.49),
  ('11111111-1111-4111-8111-111111111111', 'ACU-1KG',    'Açúcar Refinado 1kg',      '7890000000035',  4.99),
  ('11111111-1111-4111-8111-111111111111', 'ARZ-5KG',    'Arroz Branco 5kg',         '7890000000042', 27.90),
  ('11111111-1111-4111-8111-111111111111', 'FEJ-1KG',    'Feijão Carioca 1kg',       '7890000000059',  8.99),
  ('11111111-1111-4111-8111-111111111111', 'OLE-900',    'Óleo de Soja 900ml',       '7890000000066',  7.29),
  ('11111111-1111-4111-8111-111111111111', 'MAC-500',    'Macarrão Espaguete 500g',  '7890000000073',  4.49),
  ('11111111-1111-4111-8111-111111111111', 'PAO-500',    'Pão de Forma 500g',        '7890000000080',  6.99),
  ('11111111-1111-4111-8111-111111111111', 'BIS-CDT',    'Biscoito Recheado Choc.',  '7890000000097',  3.29),
  ('11111111-1111-4111-8111-111111111111', 'REF-2LT',    'Refrigerante Cola 2L',     '7890000000103',  9.99),
  ('11111111-1111-4111-8111-111111111111', 'SAB-500',    'Detergente Neutro 500ml',  '7890000000110',  2.89),
  ('11111111-1111-4111-8111-111111111111', 'PAP-12',     'Papel Higiênico 12 rolos', '7890000000127', 21.90)
ON CONFLICT (org_id, sku) DO UPDATE SET
  name       = EXCLUDED.name,
  barcode    = EXCLUDED.barcode,
  unit_price = EXCLUDED.unit_price;

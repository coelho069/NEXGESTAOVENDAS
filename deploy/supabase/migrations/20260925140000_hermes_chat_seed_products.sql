-- ============================================================================
-- Etapa 4: Seed de produtos de exemplo para testar o PDV/Chat do Hermes.
-- Precondição: 20260925120000_hermes_chat_tables_rls.sql já aplicada.
-- Idempotente: ON CONFLICT DO UPDATE por sku — pode reexecutar à vontade.
-- Valores realistas de balcão (BRL) para validar grid, busca e recibo.
-- ============================================================================

-- ON CONFLICT usa o predicado do índice parcial (sku IS NOT NULL) para casar
-- com products_sku_unique_idx criado na migration da Etapa 1.
INSERT INTO public.products (sku, name, barcode, unit_price) VALUES
  ('CAF-500',    'Café Torrado 500g',        '7890000000011', 19.90),
  ('LEI-001',    'Leite Integral 1L',        '7890000000028',  5.49),
  ('ACU-1KG',    'Açúcar Refinado 1kg',      '7890000000035',  4.99),
  ('ARZ-5KG',    'Arroz Branco 5kg',         '7890000000042', 27.90),
  ('FEJ-1KG',    'Feijão Carioca 1kg',       '7890000000059',  8.99),
  ('OLE-900',    'Óleo de Soja 900ml',       '7890000000066',  7.29),
  ('MAC-500',    'Macarrão Espaguete 500g',  '7890000000073',  4.49),
  ('PAO-500',    'Pão de Forma 500g',        '7890000000080',  6.99),
  ('BIS-CDT',    'Biscoito Recheado Choc.',  '7890000000097',  3.29),
  ('REF-2LT',    'Refrigerante Cola 2L',     '7890000000103',  9.99),
  ('SAB-500',    'Detergente Neutro 500ml',  '7890000000110',  2.89),
  ('PAP-12',     'Papel Higiênico 12 rolos', '7890000000127', 21.90)
ON CONFLICT (sku) WHERE sku IS NOT NULL DO UPDATE SET
  name     = EXCLUDED.name,
  barcode  = EXCLUDED.barcode,
  unit_price = EXCLUDED.unit_price;

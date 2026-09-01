-- Sprint 1 seed: 1 org, 2 stores, categories, products, inventory, customers
-- Auth users are created by scripts/seed-auth.ts (emails @example.invalid)

INSERT INTO public.organizations (id, name, slug, currency, timezone)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'Nex Demo Comercio',
  'nex-demo',
  'BRL',
  'America/Sao_Paulo'
);

INSERT INTO public.stores (id, org_id, name, code, is_active)
VALUES
  (
    '22222222-2222-4222-8222-222222222201',
    '11111111-1111-4111-8111-111111111111',
    'Loja Centro',
    'CENTRO',
    true
  ),
  (
    '22222222-2222-4222-8222-222222222202',
    '11111111-1111-4111-8111-111111111111',
    'Loja Shopping',
    'SHOP',
    true
  );

INSERT INTO public.categories (id, org_id, name, sort_order, is_active)
VALUES
  ('33333333-3333-4333-8333-333333333301', '11111111-1111-4111-8111-111111111111', 'Bebidas', 1, true),
  ('33333333-3333-4333-8333-333333333302', '11111111-1111-4111-8111-111111111111', 'Padaria', 2, true),
  ('33333333-3333-4333-8333-333333333303', '11111111-1111-4111-8111-111111111111', 'Higiene', 3, true);

INSERT INTO public.products (id, org_id, category_id, sku, name, unit_price, cost_price, barcode, is_active)
VALUES
  ('44444444-4444-4444-8444-444444444401', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333301', 'BEV-001', 'Agua Mineral 500ml', 3.50, 1.20, '7891000100011', true),
  ('44444444-4444-4444-8444-444444444402', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333301', 'BEV-002', 'Refrigerante Lata 350ml', 5.00, 2.50, '7891000100028', true),
  ('44444444-4444-4444-8444-444444444403', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333302', 'PAD-001', 'Pao Frances Unidade', 1.20, 0.40, '7891000200017', true),
  ('44444444-4444-4444-8444-444444444404', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333302', 'PAD-002', 'Bolo de Fuba Fatia', 8.90, 3.10, '7891000200024', true),
  ('44444444-4444-4444-8444-444444444405', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333303', 'HIG-001', 'Sabonete Liquido 250ml', 12.90, 6.00, '7891000300010', true);

INSERT INTO public.inventory_balances (org_id, store_id, product_id, quantity)
SELECT
  '11111111-1111-4111-8111-111111111111',
  s.id,
  p.id,
  CASE
    WHEN s.code = 'CENTRO' AND p.sku = 'BEV-001' THEN 120.000
    WHEN s.code = 'CENTRO' AND p.sku = 'BEV-002' THEN 80.000
    WHEN s.code = 'CENTRO' AND p.sku = 'PAD-001' THEN 200.000
    WHEN s.code = 'CENTRO' AND p.sku = 'PAD-002' THEN 24.000
    WHEN s.code = 'CENTRO' AND p.sku = 'HIG-001' THEN 35.000
    WHEN s.code = 'SHOP' AND p.sku = 'BEV-001' THEN 90.000
    WHEN s.code = 'SHOP' AND p.sku = 'BEV-002' THEN 60.000
    WHEN s.code = 'SHOP' AND p.sku = 'PAD-001' THEN 150.000
    WHEN s.code = 'SHOP' AND p.sku = 'PAD-002' THEN 18.000
    WHEN s.code = 'SHOP' AND p.sku = 'HIG-001' THEN 20.000
    ELSE 0.000
  END
FROM public.stores s
CROSS JOIN public.products p
WHERE s.org_id = '11111111-1111-4111-8111-111111111111';

INSERT INTO public.customers (id, org_id, name, document, email, phone)
VALUES
  ('55555555-5555-4555-8555-555555555501', '11111111-1111-4111-8111-111111111111', 'Cliente Consumidor', NULL, 'consumidor@example.invalid', NULL),
  ('55555555-5555-4555-8555-555555555502', '11111111-1111-4111-8111-111111111111', 'Maria Silva', '12345678901', 'maria.silva@example.invalid', '11999990001');

-- Auth users, profiles and store_members are created by: pnpm seed:auth

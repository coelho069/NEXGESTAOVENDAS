-- Remediação P0 (run-5, agente A, A1): products.cost_price era legível por qualquer
-- membro autenticado via Data API. A migração 20260917190000 concedeu SELECT na
-- TABELA inteira a authenticated; privilégios de tabela e de coluna se somam no
-- PostgreSQL, então a restrição de coluna de 20260902150536 deixou de valer.
-- RLS não oculta colunas: o controle é o GRANT de coluna.
--
-- Esta migração remove o privilégio de tabela e reafirma o GRANT de SELECT por
-- coluna SEM cost_price, com exatamente o conjunto de colunas que o app lê com a
-- sessão do usuário (GET /api/products, inventory/import e inventory/adjust leem
-- id, sku, name, unit_price, barcode, category_id, is_active, org_id). Leituras de
-- custo continuam pelas RPCs SECURITY DEFINER (get_inventory_page, create_product,
-- update_product, set_sale_item_cost_snapshot), que não dependem deste grant.
--
-- anon permanece sem privilégio (20261015120000). service_role não é afetado.

REVOKE SELECT ON TABLE public.products FROM authenticated;

GRANT SELECT (
  id, org_id, category_id, sku, name, description, unit_price, barcode,
  is_active, created_at, updated_at
) ON TABLE public.products TO authenticated;

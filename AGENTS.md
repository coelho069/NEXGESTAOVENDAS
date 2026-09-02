# AGENTS.md — Nex Gestão Vendas

Guia para agentes de código trabalhando neste repositório.

## Objetivo do produto

PDV local-first para varejo BR. Sprint atual: **4** (inventário auditado + dashboard SSR + RBAC).

## Regras inegociáveis

1. **Moeda**: BRL, valores `numeric(12,2)` — use `decimal.js` / strings `0.00` no TS. Sem `float`.
2. **Timezone**: `America/Sao_Paulo`.
3. **Estoque negativo**: bloqueado no MVP (`process_sale`, `adjust_inventory` + CHECK em `inventory_balances`).
4. **Pagamentos MVP**: apenas `cash` processado. `card`, `pix`, `voucher`, `other` → adapter `not_configured`.
5. **Fiscal**: NFC-e/SAT fora do Sprint 4. Interface + status `not_configured`.
6. **Service role**: nunca em client, logs ou `NEXT_PUBLIC_*`.
7. **Tipos DB**: gerados em `src/lib/db/types.ts` via `pnpm db:types`. Não editar manualmente.
8. **Camadas separadas**: não misturar Supabase, domínio e UI no mesmo arquivo.
9. **Rotas API**: validar com Zod (`src/lib/validation/schemas.ts`).
10. **RLS**: `anon` revogado; cashier não altera preço/custo nem vê relatórios; vendas sem UPDATE/DELETE direto; audit append-only. `PermissionGate` é só UX.

## Enums (Postgres)

- `sale_status`: draft, pending_sync, confirmed, cancelled, refunded, partially_refunded
- `payment_status`: pending, authorized, captured, failed, cancelled, refunded
- `payment_method`: cash, card, pix, voucher, other
- `sync_status`: pending, processing, synced, failed, conflict
- `inventory_movement_type`: sale, refund, restock, adjustment

## Estrutura de pastas

```
src/app
src/components
src/lib/{db,supabase,domain,adapters,validation,offline,auth,server}
src/stores
src/hooks
src/types
src/workers
supabase/migrations
tests/{unit,e2e}
docs
scripts
```

## Fluxo de venda (Sprint 1–3)

1. UI monta carrinho local (Zustand + persist) com busca, scanner HID, cliente e desconto.
2. Checkout cash online: fecha no IndexedDB e `POST /api/sales/process` → RPC `public.process_sale`.
3. Offline: grava mutação IndexedDB (`sync_status=pending`).
4. Ao voltar online: flush fila; replay idempotente por `(store_id, client_mutation_id)`.
5. Pagamento não configurado permanece rascunho local; recibo mostra status de sync.

## Inventário e dashboard (Sprint 4)

1. Quantidade **não** é editada na tabela: só `adjust_inventory` / `process_sale`, com `reason` e `actor_role` em `inventory_movements`.
2. Dashboard: RPC `get_dashboard_metrics` (COGS, margem, sell-through, cursor por SKU). Caixa recebe `forbidden_reports`.
3. CSV: `sku,delta,reason,movement_type` com relatório de erros por linha.

## O que NÃO fazer neste repo (ainda)

- NFC-e/SAT real, integração bancária real, estorno UI, pagamentos eletrônicos reais
- Expor `SUPABASE_SERVICE_ROLE_KEY`
- UPDATE/DELETE em `sales` via client
- Copiar tipos Supabase à mão
- Alterar migrations/RPC/RLS do Sprint 1 (`000001`–`000004`) ou o motor Dexie/sync do Sprint 2

## Comandos úteis

```bash
pnpm dev
pnpm typecheck
pnpm test
pnpm lint
pnpm db:types
supabase db reset   # local
pnpm seed:auth      # após reset
```

## Referências

- [docs/IMPLEMENTATION_CONTRACT.md](./docs/IMPLEMENTATION_CONTRACT.md)
- [docs/assumptions.md](./docs/assumptions.md)

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

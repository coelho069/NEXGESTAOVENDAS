# AGENTS.md — Nex Gestão Vendas

Guia para agentes de código trabalhando neste repositório.

## Objetivo do produto

PDV local-first para varejo BR. Sprint atual: **1** (foundation + PDV cash + offline queue + RPC transacional).

## Regras inegociáveis

1. **Moeda**: BRL, valores `numeric(12,2)` — use `decimal.js` / strings `0.00` no TS. Sem `float`.
2. **Timezone**: `America/Sao_Paulo`.
3. **Estoque negativo**: bloqueado no MVP (`process_sale` + CHECK em `inventory_balances`).
4. **Pagamentos MVP**: apenas `cash` processado. `card`, `pix`, `voucher`, `other` → adapter `not_configured`.
5. **Fiscal**: NFC-e/SAT fora do Sprint 1. Interface + status `not_configured`.
6. **Service role**: nunca em client, logs ou `NEXT_PUBLIC_*`.
7. **Tipos DB**: gerados em `src/lib/db/types.ts` via `pnpm db:types`. Não editar manualmente.
8. **Camadas separadas**: não misturar Supabase, domínio e UI no mesmo arquivo.
9. **Rotas API**: validar com Zod (`src/lib/validation/schemas.ts`).
10. **RLS**: `anon` revogado; cashier não altera preço/custo; vendas sem UPDATE/DELETE direto; audit append-only.

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
src/lib/{db,supabase,domain,adapters,validation,offline}
src/stores
src/hooks
src/types
src/workers
supabase/migrations
tests/{unit,e2e}
docs
scripts
```

## Fluxo de venda (Sprint 1)

1. UI monta carrinho local (Zustand + persist).
2. Checkout cash → online: `POST /api/sales/process` → RPC `public.process_sale`.
3. Offline: grava mutação IndexedDB (`sync_status=pending`).
4. Ao voltar online: flush fila; replay idempotente por `(store_id, client_mutation_id)`.

## O que NÃO fazer neste repo (ainda)

- Sprint 2/3/4 (sync avançado, relatórios, fiscal real, pagamentos eletrônicos)
- Expor `SUPABASE_SERVICE_ROLE_KEY`
- UPDATE/DELETE em `sales` via client
- Copiar tipos Supabase à mão

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

# Agent Log — Correções de integridade do fluxo de venda

**Data:** 2026-09-01
**Agente:** Cursor Grok 4.6
**Escopo:** Correções pontuais (sync status, estoque, catálogo, teto de desconto no servidor, recibo, HID). Sem alterar Dexie schema, RLS ou dashboard.

## Revisão técnica complementar

**Agente:** Cursor GPT-5.6 Luna

1. O outbox agora reivindica somente comandos ainda `pending`; respostas só são aplicadas ao registro que continua `processing` com o mesmo `updatedAt`.
2. Transições terminais não sobrescrevem `failed`, `conflict` ou `synced`; estados não sincronizados também permanecem contabilizados na UI.
3. O recibo respeita o estado exato do próprio outbox, mesmo quando existem outras vendas pendentes ou quando o dispositivo está offline.
4. Atalhos não-Escape e scanner HID são bloqueados enquanto um painel modal está aberto.
5. Fixtures de E2E não reinicializam o estoque projetado após cada atualização de tela.
6. O teto de desconto considera o total dos descontos de cabeçalho e de itens; respostas `403` entram no fluxo de conflito e restauram o estoque projetado.

## Análise (antes da implementação)

Pontos de falha confirmados no fluxo PDV + outbox:

1. **Recibo `synced` falso:** `paySale` usa só `pendingCount === 0 && online`. `countUnsyncedCommands` ignora `conflict`/`failed`, então 409/422 imprime `synced`/`confirmed`.
2. **Estoque demo:** `ensureLocalInventory` faz `bulkPut` de quantidades fictícias quando Dexie está vazio; o caixa vende contra saldo inventado e o RPC pode falhar depois.
3. **Catálogo demo:** `useProducts` cai em `DEMO_PRODUCTS` em erro/exceção, com `error` às vezes nulo — SKUs/preços que não são da org.
4. **Desconto só no client:** papel vem de `<select>`; `process_sale` só rejeita total &lt; 0. Caixa pode persistir desconto de admin.
5. **Método de pagamento divergente:** `closeSale` grava `cash`; o recibo usa `input.method`.
6. **HID/atalhos:** listener global ignora foco; F6/scanner disparam com modal/input aberto (exceto a busca, que deve continuar aceitando HID).

## Alterações necessárias

1. Função pura `resolveReceiptSyncState({ pendingCount, online, outboxStatus, conflictForSale })`; recibo lê o outbox da venda após o flush.
2. Remover semeadura em `ensureLocalInventory`; checkout e `addItem` falham fechado se o mapa local estiver vazio.
3. `useProducts` inicia vazio; falha de catálogo mostra erro e não carrega `DEMO_PRODUCTS` (fixtures E2E só com `NEXT_PUBLIC_PDV_FIXTURES=1`).
4. `discountExceedsRoleCap` no domínio; API `POST /api/sales/process` retorna **403**; RPC `assert_sale_discount_cap` chamado por `process_sale` (migration nova, sem mexer RLS).
5. Mesmo `method` em `closeSale` e no recibo.
6. `shouldAcceptHidScan` / `shouldHandleShortcut` bloqueiam input/modal; campo `pdv-search-input` permanece permitido para HID.

## Fora de escopo desta correção

Schema Dexie, policies RLS, páginas/API de dashboard, NFC-e, estorno.

---

# Agent Log — Sprint 4


**Data:** 2026-09-01  
**Agente:** Cursor Grok 4.6  
**Escopo:** Sprint 4 inventário auditado, dashboard SSR e RBAC. Sprints 1–3 não sobrescritos.

## Objetivo

CRUD de inventário sem edição direta de quantidade, métricas de rentabilidade no servidor e papéis admin/manager/cashier enforced em RLS/RPC (`PermissionGate` só UX).

## Decisões

1. **Migration nova** `20250901000005_sprint4_inventory_dashboard_rbac.sql`: `reason`/`actor_role` em `inventory_movements`; RPCs `adjust_inventory`, `get_dashboard_metrics`, `get_inventory_page`; helpers `user_can_manage_inventory` / `user_can_view_reports`; policies manager; view `analytics.product_period_metrics` (`security_invoker`, schema revogado de `anon`/`authenticated`).
2. **Quantidade** só via RPC (lock `FOR UPDATE`, bloqueio de negativo, audit_log). Sem policy de UPDATE em `inventory_balances`.
3. **Dashboard** COGS/margem/sell-through em `decimal.js` no domínio e agregação SQL; filtros loja/período `America/Sao_Paulo`; cursor SKU; estado degradado sem Supabase.
4. **CSV** `sku,delta,reason,movement_type` com erros por linha; lookup de SKU filtrado por `org_id`.
5. **RBAC:** caixa sem relatórios, ajustes e `cost_price`. Manager no seed (`manager@example.invalid`).
6. **Tipos** via snapshot + `pnpm db:types`. Sem `NEXT_PUBLIC_` de service role. Sem NFC-e, banco real ou estorno.

## Testes

- Unit: CSV (header/delta/restock/motivo), export sem custo, estoque negativo, COGS/margem/sell-through, isolamento de org, Zod, PermissionGate
- E2E: tabela de inventário + erros CSV
- E2E: dashboard degradado + caixa `permission-denied` + métricas no papel gerente

## Verificações executadas

| Comando            | Resultado |
|--------------------|-----------|
| `pnpm test`        | 41 OK     |
| `pnpm typecheck`   | OK        |
| `pnpm lint`        | OK        |
| `pnpm test:e2e`    | 9 OK      |

Migrations `000001`–`000004`, RPC `process_sale` e Dexie/sync-engine não foram modificados.

## Fora de escopo

NFC-e/SAT real, pagamentos eletrônicos reais, integração bancária, estorno UI.

---

# Agent Log — Sprint 3


**Data:** 2026-09-01  
**Agente:** Cursor Grok 4.6  
**Escopo:** Sprint 3 interface de vendas. Sprints 1 e 2 não alterados. Sprint 4 não iniciado.

## Objetivo

PDV usável: layout desktop/tablet, busca com debounce, scanner HID, estoque projetado, cliente, descontos por papel, pagamento cash, rascunho em falha e recibo HTML com status de sync.

## Decisões

1. **Domínio puro** em `src/lib/domain/sale-ops.ts` (addItem, removeItem, setQuantity, applyDiscount, calculateTotals, validateSale) com strings `0.00`.
2. **Layout** CSS: 3 colunas em `lg+`; 2 colunas em `md` + sheet de pagamento (`lg:hidden`).
3. **HID** detecta rajada < 45ms + Enter; não limpa linhas existentes.
4. **Desconto:** caixa 5%, gerente 20%, admin 100% limitado ao subtotal.
5. **Pagamento `not_configured`** → rascunho local (carrinho permanece, sem `closeSale`).
6. **Recibo** HTML com `syncStatus` / `saleStatus` (America/Sao_Paulo).
7. Catálogo e clientes demo como fallback sem Supabase (E2E local).
8. Sem mudanças em migrations, RPC, RLS, Dexie schema, outbox ou sync-engine.

## Testes

- Unit: regras de carrinho, limites de desconto, HID, recibo, atalhos, rascunho
- E2E: SKU → qtd → desconto → pagamento → recibo
- E2E: offline + status de sync no recibo
- E2E: scanner HID sem limpar carrinho
- E2E: pagamento cartão permanece rascunho
- E2E: tablet sheet

## Verificações executadas

| Comando            | Resultado |
|--------------------|-----------|
| `pnpm test`        | 32 OK     |
| `pnpm typecheck`   | OK        |
| `pnpm lint`        | OK        |
| `pnpm test:e2e`    | 7 OK      |

Sprint 1 e 2 unitários continuam passando. Migrations/RPC/RLS/Dexie schema/sync-engine não foram modificados.

## Fora de escopo

Sprint 4, pagamentos eletrônicos reais, NFC-e/SAT, relatórios, estorno UI.

---

# Agent Log — Sprint 2

**Data:** 2026-09-01  
**Agente:** Cursor Grok 4.6  
**Escopo:** Sprint 2 local-first (Dexie, outbox, sync). Sprint 1 não alterado. Sprint 3/4 não iniciado.

## Objetivo

Persistência IndexedDB transacional (`pdv_local_v1`), outbox com `clientMutationId` imutável, sync (`pushPendingCommands`, `pullChanges`, `reconcileSale`, `recordConflict`), heartbeat separado de multi-tab lock, Zustand sem token/PAN/CVV.

## Decisões

1. **Dexie** database name `pdv_local_v1` (sales, saleItems, payments, inventoryBalances, outbox, conflicts, meta).
2. **closeSale** = 1 transação IndexedDB; replay do mesmo `clientMutationId` não duplica.
3. **Retry** só faz `put` na chave existente; 10 falhas transitórias → `failed`.
4. **Backoff** 1,2,4,8,16s, teto 60s, jitter 0.5–1.0×.
5. **HTTP:** 408/429/5xx transitório; 401 encerra sessão; 409/422 `recordConflict` visível.
6. **Heartbeat** (`src/lib/offline/heartbeat.ts`) não importa nem chama `withMultiTabLock`.
7. **Zustand:** session store sem token; cart persist opcional e `stripSecrets`.
8. **API nova:** `GET /api/sync/changes` (Zod). `POST /api/sales/process` e RPC Sprint 1 intactos.
9. **Sem** `NEXT_PUBLIC_` com service role. AGENTS.md da raiz não foi recriado nem editado.

## Testes

- persist off
- reload sem duplicar
- retry seguro
- idempotência 3x
- conflito visível (409/422)
- quota IndexedDB

## Verificações executadas

| Comando            | Resultado |
|--------------------|-----------|
| `pnpm test`        | 22 OK     |
| `pnpm typecheck`   | OK        |
| `pnpm lint`        | OK        |

Sprint 1 unitários continuam passando. AGENTS.md da raiz não foi modificado.

## Fora de escopo

Sprint 3/4, pagamentos eletrônicos reais, NFC-e/SAT, relatórios, estorno UI. Migrations/RPC/RLS/adapters Sprint 1 não modificados.

---

# Agent Log — Sprint 1 bootstrap

**Data:** 2026-09-01  
**Agente:** Cursor Composer  
**Escopo:** Sprint 1 PDV local-first (somente)

## Objetivo

Criar do zero o monorepo Next.js + Supabase com PDV cash, fila offline, RPC transacional `process_sale`, RLS, seed demo e documentação de contrato.

## Decisões tomadas

1. **Next.js 14.2** App Router, TypeScript strict, Tailwind, alias `@/*`, pnpm.
2. **Migrations imperativas** em `supabase/migrations/` (4 arquivos + `seed.sql`).
3. **Tipos DB** gerados via `pnpm db:types` (CLI local ou snapshot `scripts/db-types.snapshot.ts`).
4. **Seed auth separado** (`pnpm seed:auth`) porque `auth.users` não pode ser populado só com SQL portável; usa service role server-side.
5. **Offline** com IndexedDB (`idb`) + Zustand persist; flush no evento `online`.
6. **Adapters** cash `configured`; card/pix/fiscal `not_configured`.
7. **Dinheiro** com `decimal.js` + strings `"0.00"`; sem float.
8. **RLS**: `anon` revogado; cashier read-only em produtos ativos; vendas sem UPDATE/DELETE; audit append-only.
9. **RPC `process_sale`**: SECURITY DEFINER com checks `auth.uid()` + membership; idempotência `(store_id, client_mutation_id)`; lock `FOR UPDATE` em estoque.

## Arquivos principais criados

- App: `src/app/{page,login,pdv,auth/callback}`, API `src/app/api/sales/process`, `src/app/api/auth/session`
- UI: `src/components/pdv/*`, `src/components/auth/login-form.tsx`, `src/components/providers/sync-provider.tsx`
- Domínio/lib: `src/lib/{money,supabase,domain,adapters,validation,offline}`
- Estado/hooks: `src/stores/*`, `src/hooks/*`
- Worker: `src/workers/sync-worker.ts`
- DB: `supabase/migrations/2025090100000{1..4}_*.sql`, `supabase/seed.sql`, `supabase/config.toml`
- Scripts: `scripts/generate-db-types.mjs`, `scripts/db-types.snapshot.ts`, `scripts/seed-auth.ts`
- Testes: `tests/unit/money-and-sale.test.ts`, `tests/e2e/smoke.spec.ts`
- Docs: `README.md`, `AGENTS.md`, `docs/IMPLEMENTATION_CONTRACT.md`, `docs/assumptions.md`

## Verificações executadas

| Comando            | Resultado        |
|--------------------|------------------|
| `npx tsc --noEmit` | OK               |
| `npx vitest run`   | 6 testes OK      |
| `npx next build`   | OK               |

**Não executado neste ambiente:** `supabase start` (Docker indisponível), `pnpm test:e2e` (requer browser/server), `pnpm seed:auth` (requer projeto Supabase + service role).

## Pendências para o operador humano

1. Configurar `.env` a partir de `.env.example` (sem commitar `.env`).
2. `supabase start && supabase db reset && pnpm seed:auth && pnpm db:types`.
3. Apontar `NEXT_PUBLIC_SUPABASE_*` para projeto remoto se não usar local.
4. Executar `pnpm test:e2e` após subir `pnpm dev`.

## Fora de escopo (não iniciado)

Sprint 2/3/4, pagamentos eletrônicos reais, NFC-e/SAT, relatórios, estorno UI.

## Commit

Initial Sprint 1 implementation committed on `main`.

# Implementation Contract — Sprint 1

Contrato técnico entre produto, backend Postgres/Supabase e frontend Next.js.

## 1. Domínio monetário

| Campo            | Tipo Postgres   | Tipo TS/App        |
|------------------|-----------------|--------------------|
| Preços, totais   | `numeric(12,2)` | string `"123.45"`  |
| Quantidade       | `numeric(12,3)` | number             |

Regras:

- Arredondamento half-up em 2 casas para BRL.
- Soma de itens + desconto deve fechar com pagamentos.
- Float IEEE proibido para dinheiro.

## 2. Autenticação e autorização

- Supabase Auth (email/senha).
- `profiles.org_id` define apenas o contexto da organização; `store_members.role`, resolvida por `auth.uid()` + `store_id`, é a única autoridade de autorização.
- `profiles.default_role` é metadado informativo e nunca participa de uma decisão de acesso.
- RLS em todas as tabelas `public`.
- `REVOKE ALL ... FROM anon` aplicado.
- Cashier:
  - `SELECT` produtos ativos da org
  - sem `UPDATE` de `unit_price` / `cost_price`
- Admin: CRUD produtos/categorias (policies dedicadas).

## 3. Vendas

### Estados

| Campo         | Enum          | Sprint 1 usage                          |
|---------------|---------------|-----------------------------------------|
| `sale.status` | `sale_status` | RPC grava `confirmed`                   |
| `sale.sync_status` | `sync_status` | RPC grava `synced`; offline queue usa `pending` local |

### Imutabilidade

- Sem policies de `UPDATE`/`DELETE` em `sales`, `sale_items`, `payments` para roles app.
- Correções futuras via novos fluxos (estorno/refund) — fora Sprint 1.

### RPC `public.process_sale(p_payload jsonb)`

Entrada (validada também por Zod na rota):

```json
{
  "store_id": "uuid",
  "client_mutation_id": "uuid",
  "customer_id": "uuid?",
  "discount": "0.00",
  "items": [
    {
      "product_id": "uuid",
      "quantity": 1,
      "unit_price": "3.50",
      "discount": "0.00"
    }
  ],
  "payments": [{ "method": "cash", "amount": "3.50" }]
}
```

Garantias transacionais:

1. Valida membership na loja (`user_has_store_access`).
2. Idempotência por `(store_id, client_mutation_id)` — replay retorna mesmo `sale_id` sem nova baixa.
3. Produto ativo na org; `unit_price` deve bater com catálogo.
4. Totais recalculados server-side.
5. Pagamento cash capturado; outros métodos rejeitados na RPC.
6. Lock pessimista em `inventory_balances` (`FOR UPDATE`).
7. Estoque insuficiente → erro, rollback.
8. Inserts: sale, items, payments, inventory_movements, fiscal_document (`not_configured`), audit_log.

Saída:

```json
{ "sale_id": "uuid", "replay": false, "status": "confirmed", "total": "3.50" }
```

## 4. Pagamentos e fiscal (adapters)

| Adapter            | Sprint 1 status    |
|--------------------|--------------------|
| `cash`             | `configured`       |
| `card`, `pix`, ... | `not_configured`   |
| NFC-e/SAT          | `not_configured`   |

Interface TS em `src/lib/adapters/`.

## 5. Offline local-first

- IndexedDB store `pending_mutations`.
- Checkout offline enfileira payload completo.
- Sync worker / evento `online` dispara flush → mesma rota/RPC.
- Idempotência DB evita duplicidade.

## 6. API Routes (Zod)

| Método | Rota                   | Auth | Schema                    |
|--------|------------------------|------|---------------------------|
| POST   | `/api/sales/process`   | sim  | `processSaleInputSchema`  |
| GET    | `/api/auth/session`    | opt  | —                         |

## 7. Tipos gerados

- Fonte: `supabase gen types typescript --local`
- Fallback snapshot: `scripts/db-types.snapshot.ts`
- Saída: `src/lib/db/types.ts`
- Comando: `pnpm db:types`

## 8. Seed

SQL (`supabase/seed.sql`):

- 1 org, 2 lojas, categorias, produtos, saldos, clientes

Auth (`pnpm seed:auth`):

- admin@example.invalid / Admin123!
- cashier@example.invalid / Cashier123!

## 9. Testes mínimos Sprint 1

- Unit: money, domínio sale, adapters
- E2E smoke: home + login render

## 10. Fora de escopo explícito

Sprint 2+: relatórios, estorno UI, cartão/pix real, NFC-e/SAT, multi-tenant avançado, backoffice completo.

---

# Sprint 2 — Dexie local-first e sync

Anexo. O contrato Sprint 1 (RPC `process_sale`, RLS, adapters cash/not_configured, tipos gerados) permanece válido e não foi alterado.

## IndexedDB `pdv_local_v1`

Dexie database name: `pdv_local_v1`.

Stores: `sales`, `saleItems`, `payments`, `inventoryBalances`, `outbox`, `conflicts`, `meta`.

## Fechar venda

Uma única transação IndexedDB grava: venda + itens + pagamentos + estoque projetado + outbox.

## Outbox

- Chave primária: `clientMutationId` (UUID imutável).
- Retry faz `put` na mesma chave. Nunca recria o id.
- Payload `client_mutation_id` é o mesmo valor.

## Sync

| Função | Papel |
|--------|--------|
| `pushPendingCommands` | POST `/api/sales/process` (Sprint 1) |
| `pullChanges` | GET `/api/sync/changes` |
| `reconcileSale` | Confirma venda aceita (`confirmed` / `synced`) |
| `recordConflict` | HTTP 409/422 → conflito visível |

## Backoff

`1, 2, 4, 8, 16` segundos, teto 60s, jitter `[0.5, 1.0]`. 10 falhas de transporte/resultado ambíguo → `conflict` com resultado incerto, mantendo a reserva até reconciliação autoritativa. Erros determinísticos → `failed`.

## HTTP

- 408 / 429 / 5xx: transitório (retry)
- 401: encerra sessão (não grava token)
- 409 / 422: `recordConflict`

## Concorrência

- `startHeartbeat` — liveness/online. Não adquire lock.
- `withMultiTabLock` — apenas uma aba executa a região crítica do mesmo escopo; checkout e sync usam escopo por loja.
- Fallback sem Web Locks usa lease com TTL, owner e heartbeat para recuperar locks após crash.

## Zustand

Sem `token`, PAN ou CVV. Persist do carrinho pode ser desligado (`persist: false`). `partialize` remove segredos.

## Fora de escopo (permanece)

Estorno UI, cartão/pix real, NFC-e/SAT. Relatórios e inventário: anexo Sprint 4.

---

# Sprint 3 — Interface de vendas

Anexo. Contratos Sprint 1 (RPC `process_sale`, RLS, adapters) e Sprint 2 (Dexie `pdv_local_v1`, outbox, sync) permanecem. Este sprint não altera migrations, RPC nem o motor de sync.

## Layout

| Viewport | Regiões |
|----------|---------|
| Desktop (`lg+`) | Busca esquerda, carrinho centro, resumo/ações direita |
| Tablet (`md`) | Duas regiões (busca + carrinho); pagamento em sheet |

## Regras de domínio (puras)

`addItem`, `removeItem`, `setQuantity`, `applyDiscount`, `calculateTotals`, `validateSale` em `src/lib/domain/sale-ops.ts`.

- Valores monetários em string `0.00` (`decimal.js`). Sem float para dinheiro.
- Estoque negativo bloqueado; produto inativo rejeitado.
- Estoque projetado = saldo local Dexie menos quantidade no carrinho aberto.

## Descontos

Limite percentual sobre o subtotal:

| Papel | Máximo |
|-------|--------|
| cashier | 5% |
| manager | 20% |
| admin | 100% (ainda limitado ao subtotal) |

## Pagamento e rascunho

- Somente `cash` captura (adapter `configured`).
- `card` / `pix` / demais: `not_configured` → venda permanece rascunho local (carrinho intacto, sem `closeSale`).
- Recibo HTML após captura local, com `saleStatus` e `syncStatus`.

## Busca e scanner

- Busca textual com debounce 300ms.
- Scanner HID (rajada de teclas + Enter) adiciona por SKU/código de barras **sem limpar o carrinho**.

## Atalhos

F2 / Ctrl+K busca · F4 cliente · F6 desconto · F8 pagamento · F9 recibo · Esc fecha · +/- quantidade da linha.

## Fora de escopo (permanece)

Estorno UI, cartão/pix real, NFC-e/SAT. Inventário, dashboard e RBAC: ver anexo Sprint 4.

---

# Sprint 4 — Inventário, dashboard e RBAC

Anexo. Contratos Sprint 1–3 permanecem. Nova migration `20250901000005_sprint4_inventory_dashboard_rbac.sql` apenas. Não altera `process_sale` nem Dexie/sync.

## Inventário

- Quantidade **não** tem UPDATE direto em `inventory_balances` (sem policy de escrita; CHECK `quantity >= 0`).
- Ajuste via RPC `public.adjust_inventory` (`SECURITY DEFINER`, `auth.uid()`, papel admin/manager, motivo obrigatório, `movement_type` restock|adjustment, lock `FOR UPDATE`, bloqueio de negativo).
- Auditoria: `inventory_movements.reason`, `inventory_movements.actor_role` + `audit_logs` action `adjust_inventory`.
- Listagem paginada (cursor SKU) em `get_inventory_page`. Caixa não recebe `cost_price`.
- CSV import `sku,delta,reason,movement_type` com erros por linha; export omite custo para caixa.
- CRUD de produto: `POST /api/products`, `PATCH /api/products/[id]` (Zod `0.00`); manager/admin via RLS.

## Dashboard

- View `analytics.product_period_metrics` (`security_invoker`, schema `analytics` revogado de `anon`/`authenticated`).
- RPC `get_dashboard_metrics`: receita, COGS, lucro, margem %, unidades, sell-through, filtro loja/período (`America/Sao_Paulo`), paginação cursor SKU.
- Caixa: `forbidden_reports` (API 403). `PermissionGate` é fallback de UX.
- SSR em `/dashboard` com estado degradado se Supabase estiver ausente.

## RBAC

`store_members.role` é a fonte única de autoridade. Toda rota, loader, policy e RPC
resolve o papel para a loja ativa usando `auth.uid()` + `store_id`; `PermissionGate`
e seletores do cliente são somente UX. `profiles.default_role` não é fallback.

| Papel | Inventário | Relatórios | Preço/custo |
|-------|------------|------------|-------------|
| cashier | leitura (ativos) | bloqueado | sem custo |
| manager | ajustar + produtos | sim | sim |
| admin | ajustar + produtos | sim | sim |

Índices: `sale_items (sale_id, product_id)`, movimentos por loja/tempo, vendas `(store_id, status, created_at)`.

## Fora de escopo (permanece)

NFC-e/SAT real, integração bancária real, estorno UI, pagamentos eletrônicos reais.

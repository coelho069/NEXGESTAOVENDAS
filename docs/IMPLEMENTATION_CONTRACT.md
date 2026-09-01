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
- `profiles.org_id` + `store_members.role` definem escopo.
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

`1, 2, 4, 8, 16` segundos, teto 60s, jitter `[0.5, 1.0]`. 10 falhas transitórias → `failed`.

## HTTP

- 408 / 429 / 5xx: transitório (retry)
- 401: encerra sessão (não grava token)
- 409 / 422: `recordConflict`

## Concorrência

- `startHeartbeat` — liveness/online. Não adquire lock.
- `withMultiTabLock` — apenas uma aba sincroniza.

## Zustand

Sem `token`, PAN ou CVV. Persist do carrinho pode ser desligado (`persist: false`). `partialize` remove segredos.

## Fora de escopo (não iniciado)

Sprint 3/4: relatórios, estorno UI, cartão/pix real, NFC-e/SAT.

# Nex Gestão Vendas — PDV Local-first

Sprint 3 do PDV local-first para varejo brasileiro (BRL, `America/Sao_Paulo`): interface de vendas, regras de carrinho testáveis, scanner HID e recibo com status de sincronização. Os contratos Sprint 1 (RPC cash, RLS) e Sprint 2 (Dexie outbox) permanecem.

## Stack

- Next.js 14 App Router + TypeScript strict + Tailwind (`@/*`)
- Supabase Auth + Postgres + RLS
- pnpm
- Zustand + Dexie (`pdv_local_v1`) para PDV local-first
- Zod nas rotas de API
- Vitest + Playwright

## Escopo Sprint 1

- Login Supabase
- Catálogo de produtos (cashier: somente leitura de produtos ativos)
- Carrinho PDV + checkout em **dinheiro**
- Fila offline (`pending_sync`) com replay idempotente via RPC `public.process_sale`
- Adapters cartão/pix/NFC-e/SAT expostos como `not_configured`

## Escopo Sprint 2

- Dexie `pdv_local_v1`
- Fechar venda em 1 transação IndexedDB (venda + itens + pagamentos + estoque projetado + outbox)
- Outbox com `clientMutationId` imutável
- `pushPendingCommands`, `pullChanges`, `reconcileSale`, `recordConflict`
- Heartbeat separado de multi-tab lock
- Zustand sem token / PAN / CVV

## Escopo Sprint 3

- Layout desktop (busca / carrinho / resumo) e tablet (2 regiões + pagamento em sheet)
- Busca com debounce e scanner HID sem limpar o carrinho
- Estoque projetado; bloqueio de negativo e produto inativo
- Cliente, desconto (limites por papel) e recibo HTML com status de sync
- Pagamento falho permanece rascunho local

Fora de escopo: Sprint 4 (relatórios, cartão/pix real, NFC-e/SAT).

## Setup local

```bash
pnpm install
cp .env.example .env
# Preencha NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY

# Supabase local (requer Docker)
supabase start
supabase db reset
pnpm seed:auth   # usa SUPABASE_SERVICE_ROLE_KEY apenas no servidor

pnpm db:types
pnpm dev
```

App: http://localhost:3000

### Usuários demo (seed)

| Papel   | E-mail                   | Senha        |
|---------|--------------------------|--------------|
| Admin   | admin@example.invalid    | Admin123!    |
| Caixa   | cashier@example.invalid  | Cashier123!  |

## Scripts

| Script        | Descrição                          |
|---------------|------------------------------------|
| `pnpm dev`    | Next.js dev server                 |
| `pnpm build`  | Build produção                     |
| `pnpm lint`   | ESLint                             |
| `pnpm typecheck` | `tsc --noEmit`                  |
| `pnpm test`   | Vitest unitários                   |
| `pnpm test:e2e` | Playwright smoke                 |
| `pnpm db:types` | Gera `src/lib/db/types.ts`       |
| `pnpm seed:auth` | Cria usuários Auth demo (server) |

## Segurança

- `SUPABASE_SERVICE_ROLE_KEY` **nunca** no client, logs ou bundle
- RLS ativo; role `anon` revogada em `public`
- Vendas imutáveis (sem UPDATE/DELETE direto)
- Audit log append-only

## Estrutura

```
src/app          Rotas App Router + API
src/components   UI
src/lib          Supabase, domínio, adapters, validação
src/stores       Zustand
src/hooks        React hooks
src/types        Re-exports de tipos
src/workers      Service worker sync
supabase/        Migrations + seed SQL
tests/           Unit + e2e
docs/            Contrato e decisões
```

## Documentação

- [AGENTS.md](./AGENTS.md)
- [docs/IMPLEMENTATION_CONTRACT.md](./docs/IMPLEMENTATION_CONTRACT.md)
- [docs/assumptions.md](./docs/assumptions.md)
- [docs/agent-log.md](./docs/agent-log.md)

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

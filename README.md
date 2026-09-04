# Nex Gestão Vendas

PDV local-first para varejo brasileiro, com catálogo tipado, carrinho persistido,
sincronização offline, inventário auditado, dashboard SSR e RBAC no servidor.

## Stack

- Next.js 15 App Router e TypeScript strict
- Tailwind CSS
- Supabase com clientes browser/server tipados
- Zustand para estado do carrinho
- Zod, Dexie e `decimal.js`

## Desenvolvimento

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Preencha `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` no
`.env.local`. Para usar o catálogo de demonstração sem Supabase, defina
`NEXT_PUBLIC_PDV_FIXTURES=1` somente em desenvolvimento/testes; o modo fixture
é desativado automaticamente em produção.

Variáveis server-only, como `SUPABASE_SERVICE_ROLE_KEY`, credenciais fiscais,
`FISCAL_WORKER_SECRET` e as senhas do seed, nunca devem usar o prefixo
`NEXT_PUBLIC_`, ser colocadas no navegador ou ser impressas em logs. O segredo
`FISCAL_WORKER_SECRET` deve ter ao menos 32 caracteres aleatórios. O seed
exige `SEED_ADMIN_PASSWORD`, `SEED_MANAGER_PASSWORD` e `SEED_CASHIER_PASSWORD`
no ambiente local e não exibe essas credenciais.

## Estrutura

```text
src/
├── app/                         # App Router e rotas de API
├── components/
│   ├── features/                # funcionalidades de negócio na UI
│   └── ui/                      # componentes visuais reutilizáveis
├── hooks/                       # comportamento reativo
├── lib/
│   ├── db/                      # tipos gerados e RPCs
│   ├── domain/                  # regras de domínio
│   ├── offline/                 # IndexedDB, outbox e sync
│   └── supabase/                # clientes SSR/browser e middleware
├── stores/                      # estado global Zustand
└── workers/                     # processamento em background
```

`src/lib/db/types.ts` é gerado por `pnpm db:types` e não deve ser editado
manualmente. `src/types/database.ts` existe apenas como ponto de entrada
compatível para as features.

## Caixa e terminal

O terminal é identificado por `nex-terminal-id`, persistido no navegador. Abertura,
movimentações administrativas e fechamento do caixa são operações online e passam
por RPCs idempotentes; vendas offline de uma sessão já aberta seguem o outbox
durável e geram a movimentação de dinheiro somente na reconciliação server-side.

## Verificações

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

Pipeline serializado (recomendado em CI / validação completa):

```bash
pnpm verify:pipeline
```

Ordem fixa: `typecheck → lint → test → build → test:e2e`. O E2E sobe o
`webServer` com `NEX_NEXT_DIST_DIR=.next-e2e`, isolado do artefato de
produção `.next`, para que `pnpm build` e `pnpm test:e2e` não corrompam o
mesmo cache/output se forem disparados em paralelo. Prova de isolamento:

```bash
pnpm verify:build-e2e-isolation
```

Em produção, configure `APP_ORIGIN` com a origem HTTPS pública da aplicação.
Sem `APP_ORIGIN`, mutações autenticadas por cookie são rejeitadas (fail-closed).
As APIs mutáveis rejeitam requisições cross-site e a aplicação envia CSP,
HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy` e `Permissions-Policy`.

Há um limitador em processo (`src/lib/security/rate-limit.ts`) como defesa
adicional para exportações, reconciliação de pagamento e o worker fiscal.
Chaves preferem o sujeito autenticado; `X-Forwarded-For` só é usado com
`TRUST_PROXY=1`. O contador **não** é compartilhado entre instâncias: o
proxy/edge de produção deve aplicar quotas distribuídas para login/Auth,
exportações, pagamentos e `/api/fiscal/outbox/process`. Cookies de sessão
usam `HttpOnly` + `SameSite=Lax` (+ `Secure` em produção).

CSP e exceções necessárias do Next.js estão documentadas em
`docs/SECURITY-CSP.md`.

Validação PostgreSQL/RBAC com concorrência real via dblink:

```bash
bash scripts/run-pg-rbac-validation.sh
```

Health checks (sem autenticação):

- `GET /health/liveness`
- `GET /health/readiness`

Observabilidade e recuperação: `docs/OPERATIONAL-RECOVERY.md`.
Deploy/produção/DR: `docs/PRODUCTION-DEPLOY.md` (Dockerfile + `deploy/nginx.conf.example`).

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm check:prod   # exige NODE_ENV=production + APP_ORIGIN https + Supabase
pnpm start:prod
```

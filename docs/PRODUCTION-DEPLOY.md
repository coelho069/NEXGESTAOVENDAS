# Produção, deploy e operação (Bloqueador 12)

## Arquitetura alvo

| Camada | Componente |
|--------|------------|
| Runtime app | Next.js 15 (`pnpm build` → `pnpm start` / Docker standalone) |
| Auth/DB | Supabase (Postgres + Auth + RLS) |
| Worker fiscal | HTTP `POST /api/fiscal/outbox/process` (cron/K8s CronJob/systemd timer) |
| Proxy/TLS | Nginx/Caddy/ALB com HTTPS terminado no edge |
| Estado | Stateless app; sessão em cookies HttpOnly; outbox local no browser |

Não há `docker-compose` de produção obrigatório. A imagem `Dockerfile` é a referência de container.

## Variáveis

Ver `.env.example`. Em produção (`NODE_ENV=production`):

**Obrigatórias (fail-closed no boot via `src/instrumentation.ts`):**

- `NEXT_PUBLIC_SUPABASE_URL` (https)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `APP_ORIGIN` (https, origem pública — CSRF)

**Proibidas:**

- `NEXT_PUBLIC_PDV_FIXTURES=1`

**Recomendadas:**

- `TRUST_PROXY=1` atrás de proxy que sanitiza `X-Forwarded-For`
- `FISCAL_WORKER_SECRET` (≥32 chars) se o worker fiscal estiver ativo
- Credenciais fiscais/pagamento somente quando homologadas (`not_configured` caso contrário)

Server-only nunca usa prefixo `NEXT_PUBLIC_`.

## Build e start

```bash
pnpm install --frozen-lockfile
pnpm build
NODE_ENV=production APP_ORIGIN=https://pdv.example.com \
  NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
  pnpm start
```

### Artefatos Next e E2E

| Processo | Diretório | Como |
|----------|-----------|------|
| `pnpm build` / Docker / produção | `.next` | default (`NEX_NEXT_DIST_DIR` unset) |
| Playwright `webServer` (`pnpm test:e2e`) | `.next-e2e` | `playwright.config.ts` define `NEX_NEXT_DIST_DIR=.next-e2e` |

Não compartilhe workspace mutável entre jobs de build e E2E sem esse
isolamento. Em CI use `pnpm verify:pipeline` (serial: build passa → E2E) ou
publique `.next` como artefato de job. `pnpm verify:build-e2e-isolation`
prova que build e smoke E2E podem coexistir sem race em `.next`.

Container:

```bash
docker build -t nexgestaovendas \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... .
docker run --rm -p 3000:3000 --env-file .env.production nexgestaovendas
```

A imagem:

- roda como usuário não-root `nextjs` (uid 1001)
- expõe healthcheck em `/health/liveness`
- usa `output: "standalone"`
- copia `.next/static` para a árvore standalone (obrigatório; Next não inclui)
- `CMD node server.js` (Next trata SIGTERM/SIGINT)

### Deploy atômico standalone (fail-closed)

Checklist permanente: **stop → build → copy static into standalone →
`scripts/nex-atomic-deploy-check.sh` → start → readiness + sample chunk 200**.

Não anunciar green se `.next/standalone/.next/static` estiver ausente ou
sem chunks (padrão **#5/#8**: `server.js` existe, CSS/JS 404). Ver
`docs/ATOMIC_DEPLOY.md`.

```bash
mkdir -p .next/standalone/.next
rm -rf .next/standalone/.next/static
cp -a .next/static .next/standalone/.next/static
bash scripts/nex-atomic-deploy-check.sh
# after start — host/ops default :3211; Docker image :3000
bash scripts/nex-atomic-deploy-check.sh --readiness
# Docker:
bash scripts/nex-atomic-deploy-check.sh --readiness http://127.0.0.1:3000/health/readiness
```

`--readiness` deriva a origem do sample chunk da URL de readiness
(não fixa :3211) e exige um `chunks/*.js` (preferência `main-app`).

Nginx **pode** servir `/_next/static/` do disco (`alias`) se isso já for
usado em produção — não remover; é hardening opcional (ver
`deploy/nginx.conf.example`).

## Proxy / TLS (referência)

Ver `deploy/nginx.conf.example`.

- Terminar TLS no proxy
- Encaminhar `Host`, `X-Forwarded-Proto`, `X-Forwarded-For`
- Redirecionar HTTP→HTTPS
- Não usar CORS `*` para APIs autenticadas (app é same-origin)

## Shutdown gracioso

1. Proxy para de enviar tráfego novo (readiness 503 ou drain).
2. Enviar SIGTERM ao processo Node.
3. Next.js completa requests em voo e encerra.
4. Outbox IndexedDB e `integration_outbox` permanecem duráveis — jobs não se perdem; o worker fiscal reprocessa.

Não há worker long-lived in-process além do HTTP sob demanda.

## Migrations

- Aplicar **somente** no ambiente alvo via fluxo Supabase/CI controlado.
- Este repositório **não** executa migration remota a partir dos agentes/scripts locais de validação.
- Ordem: arquivos timestamp em `supabase/migrations/`.
- Rollback de schema: restore/PITR (ver `OPERATIONAL-RECOVERY.md`), não `db reset` em produção.

## Rollback

| Camada | Procedimento |
|--------|--------------|
| Aplicação | Redeploy da imagem/tag anterior; sem migration destrutiva acoplada |
| Banco | PITR/snapshot; **não** reaplicar migrations “para trás” ad hoc |
| Secrets | Rotacionar e reiniciar app/worker |

## Multi-instance

Classificação: **SAFE MULTI-INSTANCE com limitações documentadas**

- Auth por cookies + RLS/RPC: seguro entre instâncias
- Idempotência no Postgres: segura
- Rate limit e métricas in-process: **não** compartilhados — edge/APM obrigatório
- Outbox PDV no browser: por terminal/usuário, não no servidor

## Dados de teste

Fixtures (`NEXT_PUBLIC_PDV_FIXTURES`) e seed passwords são bloqueados/ausentes em produção pelo gate de configuração e por `pdvFixturesEnabled()`.

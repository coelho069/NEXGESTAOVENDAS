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
- `CMD node server.js` (Next trata SIGTERM/SIGINT)

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

## Backup / continuity (B26)

```bash
pnpm check:backup
```

Verifica contratos, runbook, higiene de secrets e status **honesto** de continuity.
Não executa `pg_dump`/PITR e não inventa `backup_success`. Detalhes e runbook de 10 passos: `docs/OPERATIONAL-RECOVERY.md`.

## Observabilidade operacional (B27)

| Endpoint | Uso |
|----------|-----|
| `GET /health/liveness` | Processo vivo (sempre 200) |
| `GET /health/readiness` | Funções essenciais / DB probe (200/503) |
| `GET /api/health` | Snapshot operacional (componentes + alertas avaliados; sem secrets) |

Estados honestos por componente: `healthy` / `degraded` / `unhealthy` / `unknown` / `not_configured` / `external_dependency`.
Integrações opcionais `not_configured` **não** derrubam liveness. Core `database`/`readiness not_ready` → agregado ≠ `healthy` e HTTP 503.
Dispatch externo de alertas permanece `not_configured` até existir canal real.

Rate limit de `/api/health` usa `clientRateLimitKey`: só confia em `X-Forwarded-For` quando `TRUST_PROXY=1` (proxy sanitiza o IP). Sem isso, um bucket grosso impede bypass ilimitado por header forjado.

## Auditoria / governança (B28)

| Endpoint | Uso |
|----------|-----|
| `GET /api/admin/audit?store_id=` | Lista eventos (manager/admin; escopo da sessão) |

- Escrita append-only em `public.audit_logs` (authenticated sem INSERT/UPDATE/DELETE).
- `record_audit_event` deriva `org_id`/`user_id`/`actor_role` no servidor; ações genéricas são whitelist.
- Eventos de domínio (venda, caixa, estoque, etc.) continuam nas RPCs SECURITY DEFINER existentes.
- `retention_policy = not_defined` (sem exclusão automática destrutiva no app).
- Respostas/logs de auditoria não incluem secrets/PII (sanitização de metadata).

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

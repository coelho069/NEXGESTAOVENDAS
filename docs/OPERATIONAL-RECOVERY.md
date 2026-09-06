# Observabilidade, recuperação e disaster recovery (B26)

## Correlation / request ID

- Middleware e rotas `/health/*` propagam `x-correlation-id` e `x-request-id`.
- Se o cliente não enviar um ID válido, o servidor gera um UUID.
- Logs estruturados JSON incluem `correlationId` quando o handler usa
  `createRequestObservability`.

## Health

| Endpoint | Semântica |
|----------|-----------|
| `GET /health/liveness` | Processo vivo. Sem dependências. Sempre 200. Sem secrets. |
| `GET /health/readiness` | Pronto para tráfego. Verifica env Auth, gate de produção e consulta leve em `stores`. 200/503. Não retorna secrets. |

Timeouts: healthchecks de container devem usar ≤5s; readiness pode falhar fechado se DB estiver lento.

**Backup status não é inventado em `/health/*`.** Continuity honesta é consultada via:

```bash
pnpm check:backup
```

Campos possíveis (`backup_available`, `backup_last_verified`, `backup_status`, `recovery_ready`) só ficam `verified` / `recovery_ready=true` quando o operador atestar um drill real (`BACKUP_STATUS` + `BACKUP_LAST_VERIFIED_AT`). Sem attestação: `operator_managed` / `unknown` / `recovery_ready=false`.

## Confiabilidade já existente

- Outbox local (vendas + inventário) com CAS, backoff exponencial e limite de falhas.
- Idempotência server-side via `client_mutation_id` / advisory locks / replay.
- Outbox fiscal durável (`integration_outbox`) reclamado pelo worker.
- Sync engine trata timeout/resultado ambíguo como conflito incerto (não duplica).

## Fonte da verdade e estado local

| Camada | Papel |
|--------|-------|
| Postgres (Supabase) | **Fonte da verdade** corporativa |
| IndexedDB / outbox PDV | Cache + fila do terminal; **não** é backup corporativo |
| `integration_outbox` | Fila server-side durável (fiscal) |
| Imagem app / registry | Artefato imutável de aplicação |
| Secrets / vault | Fora do git |

O sistema **não** depende de estado local irreversível para a verdade financeira: retries reenviam a mesma `client_mutation_id` e o servidor deduplica.

## Dados críticos para recuperação

Organizations, stores, profiles/RBAC (`store_members`), products, inventory balances/movements, sales, sale_items, payments, cash_sessions/movements, customers, fiscal_documents, store_settings, audit_logs, integration_outbox, idempotency_keys.

Contrato de código: `CRITICAL_RECOVERY_ENTITIES` em `src/lib/domain/backup-continuity.ts`.

## Disaster recovery — RPO / RTO

| Objetivo | Valor operacional | Notas |
|----------|-------------------|-------|
| RPO (perda máxima de dados) | **Depende do provedor Postgres** (ex.: PITR contínuo Supabase ≈ minutos; snapshot diário ≈ até 24h) | A app não define RPO sozinha |
| RTO (tempo até serviço) | **Manual**: redeploy app + restore DB + smoke health | Sem orquestração in-app |

**NÃO TESTADO — LIMITAÇÃO DE INFRAESTRUTURA:** restore PITR real e failover de região não foram executados neste ambiente (sem projeto Supabase remoto de DR dedicado). A app **nunca** inventa um flag de sucesso de backup.

## Backup

| Ativo | Responsável | Método |
|-------|-------------|--------|
| Postgres (fonte da verdade) | Operador / Supabase | PITR + snapshots diários |
| Secrets | Operador / vault | Fora do git; rotacionar |
| Imagem app | CI/registry | Tags imutáveis |
| IndexedDB PDV | Terminal local | Não é backup corporativo; outbox reenvia após restore de rede |

A aplicação **não** orquestra backup automático (`pg_dump`, snapshots ou PITR).

### Attestação opcional (operador)

Após um drill real de backup/restore, o operador pode registrar (server-only, nunca `NEXT_PUBLIC_*`):

```bash
BACKUP_STATUS=verified          # verified | failed | unset
BACKUP_LAST_VERIFIED_AT=2026-09-06T12:00:00.000Z
```

Sem esses valores, `pnpm check:backup` reporta `recovery_ready=false`.

## Restore — camadas distintas

| Camada | O que restaurar | O que NÃO fazer |
|-------|-----------------|-----------------|
| **database** | PITR/snapshot Postgres | `supabase db reset` em produção |
| **application** | Redeploy da tag compatível com o schema | Misturar schema novo com DB antigo sem validar |
| **configuration** | Env/runtime não-secret (APP_ORIGIN, flags) | Commitar `.env` real |
| **secrets** | Vault / secret store | Colocar service-role em `NEXT_PUBLIC_*` ou logs |
| **outbox_reprocess** | Worker fiscal + sync PDV com mesma mutation id | Forçar “nova venda” no retry |

## Runbook operacional B26 (10 passos)

### 1. Pré-requisitos

- Acesso ao projeto Supabase / console PITR.
- Tag de app conhecida compatível com o schema do ponto de restore.
- Secrets no vault (não no git).
- Janela de manutenção comunicada.
- `pnpm check:backup` e docs locais disponíveis.

### 2. Identificação da falha

- Classificar: DB indisponível, corrupção, migration ruim, app crash, perda de região, secrets vazados.
- Coletar `x-correlation-id` / logs estruturados (sem secrets).
- Registrar horário UTC do incidente.

### 3. Proteção dos dados

- Congelar deploys.
- Drenar tráfego (readiness 503 / proxy drain).
- **Não** executar `supabase db reset`.
- **Não** apagar migrations históricas.
- **Não** “corrigir” dados financeiros com SQL ad hoc sem backup do estado atual.

### 4. Restauração

1. Restaurar Postgres para o ponto escolhido (PITR/snapshot).
2. Redeploy da tag de app compatível.
3. Restaurar secrets do vault (valores novos se houve vazamento).
4. Restaurar configuração não-secret (`APP_ORIGIN`, etc.).

### 5. Validação pós-restore

- Contagens básicas: stores, sales recentes, cash sessions abertas.
- Amostra de `client_mutation_id` únicos (sem duplicata por loja).
- Conferir que RLS ainda está habilitado nas tabelas críticas.

### 6. Smoke tests

- `GET /health/liveness` → 200.
- `GET /health/readiness` → 200 com DB ok (sem secrets no body).
- Login + abrir PDV de uma loja de teste.
- Venda cash de valor mínimo em ambiente controlado (ou fixture isolado).

### 7. Validação RLS

- Usuário da org A não lê loja da org B.
- Cashier não acessa dashboard/admin.
- Scripts: `scripts/run-pg-rbac-validation.sh` / `scripts/pg-rbac-validation.sql` quando houver DB de validação.

### 8. Validação de Migrations

- Confirmar versão/lista de migrations aplicadas no ambiente restaurado.
- App tag deve corresponder ao schema; se migration pós-backup for necessária, aplicar **somente** pelo fluxo controlado (nunca reset).

### 9. Validação de Integridade

- Vendas ↔ sale_items ↔ payments consistentes.
- Movimentos de estoque encadeados / balances.
- Caixa: sessions e movements alinhados.
- Fiscal: documentos sem status `issued` inventado.
- Outbox: retries com a **mesma** `client_mutation_id` (retry ≠ duplicate sale/payment/stock).

### 10. Retorno do serviço

- Reabilitar tráfego no proxy.
- Reprocessar worker fiscal (`POST /api/fiscal/outbox/process`) se houver pendências.
- Terminais PDV: ao voltar online, sync reenvia outbox local.
- Attestar drill: definir `BACKUP_STATUS=verified` + `BACKUP_LAST_VERIFIED_AT` se o restore foi bem-sucedido.
- Post-mortem sem colar secrets.

## Outbox / offline após recovery

| Situação | Comportamento esperado |
|----------|------------------------|
| Restart do browser | Outbox IndexedDB persiste; sync retoma |
| Perda de conexão | Venda local pode ficar `pending_sync`; servidor deduplica no replay |
| Falha parcial HTTP | Timeout/ambiguidade → não assume sucesso; não duplica |
| Retry deliberado | Mesma `client_mutation_id` → efeito financeiro único |

`retry != duplicate sale`  
`retry != duplicate payment`  
`retry != duplicate stock movement`

Offline **não** é segunda fonte de verdade.

## Rollback

| Camada | Ação segura |
|--------|-------------|
| App | Redeploy da tag anterior |
| Migration | **Não** “desfazer” SQL ad hoc; preferir restore para instante pré-migration |
| Feature flags/env | Remover provider keys incompletas → `not_configured` |

Proibido em produção: `supabase db reset`, `git reset --hard` destrutivo, apagar migrations históricas, `exec(user_input)` em scripts de recovery.

## Rotação de secrets

1. Gerar novo valor (service role, `FISCAL_WORKER_SECRET`, API keys).
2. Atualizar secret store / env do runtime.
3. Reiniciar app e jobs do worker.
4. Revogar valor antigo no provedor.
5. Auditar logs para garantir ausência do secret em texto.

## Segurança no recovery

O procedimento **não** permite:

- bypass de RLS pela app;
- acesso cross-org / cross-store;
- reescrita de auditoria;
- duplicação de transações via retry;
- versionar `.env` real;
- expor service-role / API keys em `NEXT_PUBLIC_*` ou logs;
- execução arbitrária de shell a partir de input de operador.

## Métricas / multi-instância

Contadores in-process (`src/lib/observability/metrics.ts`) e rate limit local **não** agregam entre réplicas. Em multi-instância:

- Edge/WAF para rate limit distribuído
- APM/Prometheus para métricas

Pendência herdada do B11: métricas in-process multi-instância.

## Classificação multi-instance

**SAFE MULTI-INSTANCE com limitações documentadas** (auth/RLS/idempotência OK; rate limit/métricas locais limitados).

## Verificação contínua

```bash
pnpm check:backup    # contratos + docs + higiene de secrets + status honesto
pnpm check:prod      # gate de configuração de produção
pnpm test            # inclui invariantes B26 / idempotência
```

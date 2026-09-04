# Observabilidade, recuperação e disaster recovery

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

## Confiabilidade já existente

- Outbox local (vendas + inventário) com CAS, backoff exponencial e limite de falhas.
- Idempotência server-side via `client_mutation_id` / advisory locks / replay.
- Outbox fiscal durável (`integration_outbox`) reclamado pelo worker.
- Sync engine trata timeout/resultado ambíguo como conflito incerto (não duplica).

## Disaster recovery — RPO / RTO

| Objetivo | Valor operacional | Notas |
|----------|-------------------|-------|
| RPO (perda máxima de dados) | **Depende do provedor Postgres** (ex.: PITR contínuo Supabase ≈ minutos; snapshot diário ≈ até 24h) | A app não define RPO sozinha |
| RTO (tempo até serviço) | **Manual**: redeploy app + restore DB + smoke health | Sem runbook automatizado in-app |

**NÃO TESTADO — LIMITAÇÃO DE INFRAESTRUTURA:** restore PITR real e failover de região não foram executados neste ambiente (sem projeto Supabase remoto de DR dedicado).

## Backup

| Ativo | Responsável | Método |
|-------|-------------|--------|
| Postgres (fonte da verdade) | Operador / Supabase | PITR + snapshots diários |
| Secrets | Operador / vault | Fora do git; rotacionar |
| Imagem app | CI/registry | Tags imutáveis |
| IndexedDB PDV | Terminal local | Não é backup corporativo; outbox reenvia após restore de rede |

A aplicação **não** orquestra backup automático.

## Restore

1. Congelar deploys; drenar tráfego (readiness/proxy).
2. Restaurar Postgres para o ponto escolhido (PITR/snapshot).
3. Redeploy da tag de app compatível com o schema restaurado.
4. Validar `/health/liveness` e `/health/readiness`.
5. Reprocessar worker fiscal (`/api/fiscal/outbox/process`) se houver outbox pendente.
6. Terminais PDV: ao voltar online, sync reenvia outbox local com a mesma `client_mutation_id`.

## Rollback

| Camada | Ação segura |
|--------|-------------|
| App | Redeploy da tag anterior |
| Migration | **Não** “desfazer” SQL ad hoc; preferir restore para instante pré-migration |
| Feature flags/env | Remover provider keys incompletas → `not_configured` |

Proibido em produção: `supabase db reset`, `git reset --hard` destrutivo, apagar migrations históricas.

## Rotação de secrets

1. Gerar novo valor (service role, `FISCAL_WORKER_SECRET`, API keys).
2. Atualizar secret store / env do runtime.
3. Reiniciar app e jobs do worker.
4. Revogar valor antigo no provedor.
5. Auditar logs para garantir ausência do secret em texto.

## Métricas / multi-instância

Contadores in-process (`src/lib/observability/metrics.ts`) e rate limit local **não** agregam entre réplicas. Em multi-instância:

- Edge/WAF para rate limit distribuído
- APM/Prometheus para métricas

Pendência herdada do B11: métricas in-process multi-instância.

## Classificação multi-instance

**SAFE MULTI-INSTANCE com limitações documentadas** (auth/RLS/idempotência OK; rate limit/métricas locais limitados).

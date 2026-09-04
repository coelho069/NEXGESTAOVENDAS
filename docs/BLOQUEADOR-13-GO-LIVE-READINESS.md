# BLOQUEADOR 13 — GO-LIVE READINESS

**Data da auditoria:** 2026-09-04
**Repositório:** `/home/ubuntu/NEXGESTAOVENDAS`
**Método:** execução direta das Fases 1–21 (código, migrations, unit, E2E, SQL PG-RBAC, lint, typecheck, build, audit, supabase db lint, inventário git). Sem Plan Mode, sem commits, sem migrations remotas, sem alteração de migrations históricas.

---

## Status

**GO-LIVE READY WITH INFRASTRUCTURE LIMITATIONS**

> **Atualização (race build×E2E):** isolado via `NEX_NEXT_DIST_DIR=.next-e2e` no Playwright + pipeline serial `pnpm verify:pipeline`. Prova: `pnpm verify:build-e2e-isolation` (2 rounds PASS). Ver `docs/BLOQUEADOR-13-RACE-FIX.md`.

---

## FASE 1 — Mapa completo do sistema

| Módulo | Status | Evidência principal |
|--------|--------|---------------------|
| Auth | PASS | `src/lib/auth/session.ts`, middleware, cookies HttpOnly/SameSite |
| RBAC | PASS | `store_members.role` + `user_store_role`; PermissionGate só UX |
| RLS | PASS | Cadeia de migrations + PG cenários 1–165 |
| Organização | PASS (dados) | Schema/seed; sem UI admin (BACKLOG produto) |
| Loja | PASS | Membership + store context; sem CRUD UI (BACKLOG) |
| Terminal | PASS | `terminal-identity.ts` + cash/sale binding |
| Produtos | PASS | API + RPC; cashier sem mutação de preço |
| Categorias | BACKLOG | Campo em produto; sem CRUD dedicado |
| Estoque | PASS | B4 precision/idempotency + PG |
| Carrinho | PASS | Zustand + persist; escopo por usuário em fixtures |
| Venda | PASS | `process_sale` / outbox / idempotência |
| Pagamento | PASS (cash) | State machine; card/Pix `not_configured` |
| Caixa | PASS | open/move/close + isolamento |
| Fiscal | PASS (boundary) | Anti-fake-success; provider opcional |
| Vendas suspensas | PASS | claim/recover/release |
| Dashboard | PASS | Só confirmed+captured; cashier negado |
| Sincronização | PASS | IndexedDB + `/api/sync/changes` |
| Outbox | PASS | Local + `integration_outbox` fiscal |
| Reconciliation | PASS | Payment/fiscal/sync |
| Auditoria | PASS (backend) | `audit_logs`; sem UI (BACKLOG) |
| Observabilidade | PASS | correlation IDs, health, logs estruturados |
| Admin | BACKLOG | Role existe; sem `/admin` UI |
| Configuração | PASS | Fail-closed `production/config.ts` |

---

## Fluxo crítico

| Item | Resultado | Evidência |
|------|-----------|-----------|
| Login → org → loja → terminal → produto → estoque → carrinho → desconto → checkout → pagamento → caixa → fiscal → conclusão → estoque → dashboard → auditoria | **PASS** | Domínio/API + PG cenários 7–8, 43, 63, 97+, 121; E2E PDV (fixtures) + SQL autenticado |
| Consistência bruto / desconto / líquido | **PASS** | `tests/unit/sprint3-sale-ops.test.ts`, `money-and-sale.test.ts`, RPC discount cap |
| Troco | **BACKLOG** | Documentado em `docs/assumptions.md`: troco não modelado; cash = valor da venda |
| Isolamento Org/Loja A/A, A/B, B/A, B/B + IDs forjados | **PASS** | PG 2–5, 49–50, 118–119, 127–159; E2E blocker10 |
| Roles admin/manager/cashier server-side | **PASS** | PG 1, 85, 121; API `canEditProducts` / `canViewReports` / discount caps |
| Venda normal (multi-item, decimais, estoque, retry/timeout) | **PASS** | Unit sprint2/3 + PG 7, 15–22 |
| Pagamento (pending/authorized/captured/failed/unknown) | **PASS** | `payment-state.test.ts` + PG 68–72 |
| Caixa open→sale→movement→close | **PASS** | E2E sprint5 + PG 34–50 |
| Estoque inicial→venda→movimento→saldo | **PASS** | Unit inventory-blocker4 + PG 10–25 |
| Venda suspensa suspend→recover→concluir | **PASS** | E2E sprint6 + PG 51–67 |
| Fiscal not_configured/issued/failed/unknown/cancelled | **PASS** | Adapter anti-sucesso falso + PG 73–96 |
| Dashboard vs dados persistidos | **PASS** | PG 97–126 + unit/e2e blocker9 |
| Offline/online outbox + HWM + sem duplicação | **PASS** | sprint2 unit + sync-engine + PG 27–29, 160–165 |
| Crash recovery / integridade pós-interrupção | **PASS** (app) | Outbox CAS/idempotência; kill OS harness = BACKLOG |

---

## Segurança

| Item | Resultado |
|------|-----------|
| Secrets | **PASS** |
| Auth / Session / Cookies | **PASS** |
| CSRF | **PASS** |
| CORS | **PASS** (same-origin; sem `*`) |
| CSP | **PASS** (residual `'unsafe-inline'` documentado → BACKLOG nonce) |
| XSS | **PASS** |
| SQLi | **PASS** |
| Mass Assignment | **PASS** |
| RLS | **PASS** |
| SECURITY DEFINER | **PASS** (`search_path` + `auth.uid()`) |
| Rate Limit | **LIMITAÇÃO EXTERNA** (in-process; edge obrigatório multi-instância) |
| Logs sem secrets | **PASS** |
| LGPD (retenção/DSAR) | **BACKLOG** |
| Uploads | **PASS** (CSV tipado, body ≤2MB) |
| Adversarial API (tenant/role/UUID/replay/concorrência) | **PASS** (PG 127–159 + E2E blocker10) |

---

## Confiabilidade

| Item | Resultado |
|------|-----------|
| Idempotência venda/estoque/pagamento/fiscal | **PASS** |
| Outbox local + fiscal durável | **PASS** |
| Reconciliação unknown≠sucesso | **PASS** |
| Health liveness/readiness | **PASS** |
| Correlation / request ID | **PASS** |
| Métricas distribuídas | **LIMITAÇÃO EXTERNA** (in-process) |
| PITR / failover real | **LIMITAÇÃO EXTERNA** (provedor; não testado neste ambiente) |

---

## Produção

| Item | Resultado |
|------|-----------|
| `pnpm build` (limpo) | **PASS** |
| Env fail-closed / fixtures proibidos em prod | **PASS** |
| HTTPS / proxy / headers | **PASS** (Next + `deploy/nginx.conf.example`) |
| Migrations forward-only | **PASS** |
| Rollback documentado | **PASS** |
| Mocks/fixtures em produção | **PASS** (bloqueados) |
| Dockerfile non-root + HEALTHCHECK | **PASS** |

**Nota:** primeira execução de `pnpm build` em paralelo com E2E falhou com `PageNotFoundError: /_document` no prerender `/404`. Rebuild limpo (`rm -rf .next && pnpm build`) **PASS**. Tratar como contenção de cache/concorrência de artefato, não como defeito de código.

---

## Testes

| Suite | Resultado | Contagens reais |
|-------|-----------|-----------------|
| `pnpm test` (Vitest) | **PASS** | **22** arquivos, **187** testes, 0 falhas, **0 SKIPPED** |
| `pnpm lint` | **PASS** | 0 erros |
| `pnpm typecheck` | **PASS** | `tsc --noEmit` OK |
| `pnpm build` | **PASS** (rebuild limpo) | 24 páginas geradas |
| `pnpm audit` | **PASS** | No known vulnerabilities found |
| `supabase db lint --local` | **PASS** | No schema errors found |
| `git diff --check` | **PASS** | sem erros de whitespace |
| PostgreSQL `scripts/run-pg-rbac-validation.sh` | **PASS** | Cenários **1–165** → `PG-RBAC-VALIDATION: ALL SCENARIOS PASSED` |
| `pnpm test:e2e` (Playwright) | **PASS com flake residual** | 1ª run: **35 passed / 1 failed** (`scanner HID`); retry isolado do mesmo caso: **PASS**. **0 SKIPPED** |

---

## Limitações externas

| Limitação | Impacto | Mitigação | Responsável | Próximo passo |
|-----------|---------|-----------|-------------|---------------|
| Rate limit in-process (`src/lib/security/rate-limit.ts`) | Quotas não compartilhadas entre réplicas | WAF/edge rate limit em login, export, payments, fiscal worker; `TRUST_PROXY=1` atrás de proxy sanitizado | Ops / Infra | Configurar quotas no proxy/CDN antes do scale-out |
| Métricas in-process (`src/lib/observability/metrics.ts`) | Sem agregação multi-instância | APM/Prometheus/OpenTelemetry | Ops / SRE | Ligar exporter APM no runtime |
| PITR / failover de região não executado | RPO/RTO dependem do provedor; restore real não comprovado aqui | PITR + snapshots Supabase; runbook em `docs/OPERATIONAL-RECOVERY.md` | DBA / Supabase admin | Executar drill de restore em projeto DR dedicado |

---

## Bloqueadores

**Nenhum bloqueador de aplicação remanescente para go-live do MVP cash-only** (com limitações externas acima aceitas operacionalmente).

Itens de produto/compliance fora do gate crítico (não bloqueiam go-live MVP):

- Troco de venda (cash drawer) — BACKLOG documentado
- Providers cartão/Pix/NFC-e reais — `not_configured` até homologação
- UI Admin / Categorias CRUD / console de auditoria — BACKLOG
- LGPD DSAR/retenção — BACKLOG compliance
- E2E autenticado full-stack (hoje fixtures + PG server-side) — BACKLOG de cobertura
- Flake residual do scanner HID sob paralelismo E2E — estabilizar seletor/foco

---

## Integridade Git

| Restrição | Conformidade |
|-----------|--------------|
| Sem `git reset` | **OK** |
| Sem commits nesta auditoria | **OK** |
| Sem apply de migrations remotas | **OK** |
| Sem edição de migrations históricas | **OK** — `git diff` vazio em migrations tracked; 11 históricas intactas |
| Migrations novas B4–B12 | **OK** — 14 arquivos untracked em `supabase/migrations/` (adições autorizadas da trilha de bloqueadores), total 25 |
| Alterações existentes preservadas | **OK** — working tree mantida (~81 modificados, ~87 untracked, 1 deleted `eslint.config.mjs`) |
| Inventário | `git status --short`: ~169 entradas; `git diff --stat`: **82 files changed, 12849 insertions(+), 1811 deletions(-)** |

---

## DECISÃO FINAL

**GO-LIVE READY WITH INFRASTRUCTURE LIMITATIONS**

Condições operacionais obrigatórias no deploy:

1. `NODE_ENV=production`, `APP_ORIGIN` HTTPS, Supabase HTTPS, **sem** `NEXT_PUBLIC_PDV_FIXTURES`.
2. TLS no edge + headers de proxy; `TRUST_PROXY=1` quando o proxy sanitiza `X-Forwarded-For`.
3. Rate limit/WAF distribuído e APM para métricas (limitações in-process).
4. Aplicar a cadeia completa de migrations no ambiente alvo via fluxo controlado (não pelos agentes).
5. Aceitar escopo MVP: pagamento cash confirmado; cartão/Pix/fiscal real permanecem `not_configured` até homologação; troco e LGPD em backlog.

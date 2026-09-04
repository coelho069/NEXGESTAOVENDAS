# BLOQUEADOR 14 — MIGRATIONS / RELEASE INTEGRITY

**Data:** 2026-09-04
**Ação:** auditoria das 14 migrations untracked + `git add` (staging only). Sem commit, push, reset ou apply remoto.

## Status

**APROVADO**

## Inventário

| Métrica | Valor |
|---------|-------|
| Tracked antes | **11** |
| Untracked antes | **14** |
| Total em disco | **25** |
| No index após regularização | **25** (`git ls-files`) |
| Staged (A) | **14** |
| Históricas modificadas | **0** |

## Migrations auditadas

| Arquivo | Status | Origem/Bloqueador | Duplicação | Segurança |
|---------|--------|-------------------|------------|-----------|
| `20260903183303_rbac_deny_by_default.sql` | Legítima → staged | Pré-B4 / RBAC deny-by-default | Não | PASS (`search_path`, REVOKE/GRANT, store_members) |
| `20260903192557_enforce_product_barcode_uniqueness.sql` | Legítima → staged | Catálogo / barcode | Não | PASS (unique parcial org+barcode) |
| `20260903210718_inventory_adjustment_idempotency.sql` | Legítima → staged | **B4** idempotência | Não | PASS (DEFINER + search_path) |
| `20260903215443_inventory_precision_and_sync.sql` | Legítima → staged | **B4** precisão/sync | Não | PASS (REVOKE writes, SELECT only) |
| `20260903231500_inventory_movement_chain_invariant.sql` | Legítima → staged | **B4** follow-up cadeia | Sobreposição intencional com next* | PASS |
| `20260903232000_inventory_movement_sequence.sql` | Legítima → staged | **B4** follow-up sequência | Sobreposição intencional com prev* | PASS |
| `20260904001807_cash_terminal_integrity.sql` | Legítima → staged | **B5** caixa/terminal | Não | PASS |
| `20260904070926_suspended_sales_integrity.sql` | Legítima → staged | **B6** suspensas | Não | PASS |
| `20260904074442_payment_reconciliation_integrity.sql` | Legítima → staged | **B7** pagamento | Não | PASS |
| `20260904114749_fiscal_integration_outbox.sql` | Legítima → staged | **B8** fiscal/outbox | Não | PASS |
| `20260904130000_dashboard_financial_consistency.sql` | Legítima → staged | **B9** dashboard | Não | PASS |
| `20260904131500_dashboard_scope_hardening.sql` | Legítima → staged | **B9** follow-up cross-org | Não | PASS |
| `20260904133504_production_security_hardening.sql` | Legítima → staged | **B10/B12** REVOKE/prod | Não | PASS |
| `20260904140000_b10_security_hardening.sql` | Legítima → staged | **B10** search_path mass | Não | PASS |

\*As migrations `…231500` e `…232000` reaplicam de forma idempotente (`IF NOT EXISTS` / `CREATE OR REPLACE`) o reforço da cadeia de movimentos — arquivos distintos, timestamps ordenados, sem duplicata de timestamp.

## Ordem / Dependências / Conflitos

| Item | Resultado |
|------|-----------|
| Ordem de timestamps | **PASS** (crescente, sem duplicatas) |
| Dependências | **PASS** (cadeia após `20260903145947`; B4→B10 sequencial) |
| Conflitos | **PASS** (nenhuma histórica alterada; sem conflitos de conteúdo indevido) |

## Segurança

| Controle | Resultado |
|----------|-----------|
| RLS / helpers store-scoped | **PASS** |
| GRANT/REVOKE | **PASS** |
| SECURITY DEFINER | **PASS** |
| `search_path` fixo | **PASS** (incl. B10 em massa) |
| Cross-org | **PASS** (PG + `assert_sale_item_scope`) |
| Cross-store | **PASS** (PG adversarial 118–159) |

## Regularização Git

| Item | Valor |
|------|-------|
| Migrations legítimas no staging | **14** |
| Indevidas | **0** |
| Históricas alteradas | **0** |
| `git diff` working tree em migrations | vazio |
| `git diff --cached` | apenas 14 **A** (+7098 linhas) |

## Validação

| Suite | Resultado |
|-------|-----------|
| PostgreSQL RBAC 1–165 | **165/165 PASS** |
| Unit | **188/188 PASS** |
| E2E | **37/37 PASS** |
| Lint | **PASS** |
| Typecheck | **PASS** |
| Build | **PASS** |
| DB lint | **PASS** |
| `pnpm audit` | **PASS** |
| Diff check (WT + cached) | **PASS** |
| Skipped críticos | **0** |

## Integridade

Reset: **NÃO** | Commit: **NÃO** | Push: **NÃO** | Migration remota: **NÃO** | Alterações preservadas: **SIM**

## Pendências

Nenhuma pendência de migrations. Próximo passo operacional (fora deste bloqueador): commit humano da cadeia staged + apply controlado no ambiente alvo.

## Decisão

**APROVADO**

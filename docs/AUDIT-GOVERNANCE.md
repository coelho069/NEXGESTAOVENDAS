# B28 — Auditoria e governança operacional

## Fonte da verdade

Tabela existente `public.audit_logs` (Sprint 1+). **Não** foi criada tabela duplicada.

| Coluna | Papel B28 |
|--------|-----------|
| `id` | id |
| `created_at` | occurred_at |
| `org_id` | organization_id (derivado da loja no servidor) |
| `store_id` | store_id |
| `user_id` | actor_user_id (`auth.uid()`) |
| `action` | action |
| `entity_type` | resource_type |
| `entity_id` | resource_id |
| `payload` | result, actor_role, correlation_id, operation_id, metadata |

Contrato TypeScript: `src/lib/observability/audit.ts`  
Writer/reader: `src/lib/server/audit.ts`  
RPCs: `record_audit_event`, `list_audit_events` (`supabase/migrations/20260906120000_b28_audit_governance.sql`)

## Imutabilidade (append-only)

| Operação | `anon` | `authenticated` |
|----------|--------|-----------------|
| SELECT | sem acesso (RLS) | escopo `user_can_view_reports(store)` |
| INSERT | bloqueado | bloqueado (escrita só via SECURITY DEFINER) |
| UPDATE | bloqueado | bloqueado |
| DELETE | bloqueado | bloqueado |

Integridade: **append-only + RLS + privilégios DB**. Sem hash-chain criptográfica.

```text
integrity.mechanism = append_only_rls
integrity.hash_chaining = false
```

Limitações honestas: quem possui `service_role` / superuser pode alterar o histórico no banco. O app não alega segurança criptográfica absoluta.

## Server authority

Nunca confiar no cliente para:

- `actor_user_id` / `actor_role`
- `organization_id` / `org_id`
- `result`

`record_audit_event` rejeita `org_id`, `organization_id`, `user_id`, `actor_user_id` no payload.  
`org_id` e `user_id`/`actor_role` são derivados de `stores` + `auth.uid()` + membership.

Na API `GET /api/admin/audit`:

- `?organization_id=` / `?org_id=` → `400 invalid_scope`
- `?store_id=` fora da sessão/membership → `403`
- `?actor_user_id=` / `?actor=` → **somente filtro de linhas**; não redefine o ator da sessão

## Operações críticas (cobertura real)

| Contrato B28 | Status | Persistido como |
|--------------|--------|-----------------|
| `sale.created` | covered | `sale.confirmed` (process_sale RPC) |
| `sale.cancelled` | covered | `sale.cancelled` (B18 RPC) |
| `sale.returned` | covered | `sale.returned` (B18 RPC) |
| `payment.created` | covered | `payment.created` (trigger) |
| `payment.refunded` | covered | `payment.refunded` (trigger status) |
| `cash.opened` | covered | `cash.opened` |
| `cash.closed` | covered | `cash.closed` |
| `cash.movement` | covered | `cash.movement_recorded` / `cash.sale_captured` |
| `inventory.adjusted` | covered | `adjust_inventory` |
| `customer.created` | covered | `customer.created` |
| `customer.updated` | covered | `customer.updated` |
| `customer.deleted` | **NOT APPLICABLE** | sem operação de delete no código |
| `settings.updated` | covered | `settings.updated` (API) + `store_settings.updated` (RPC) |
| `fiscal.issue_requested` | covered | API + `fiscal.issue.requested` (outbox) |
| `fiscal.cancel_requested` | covered | API + `fiscal.cancel.requested` (outbox) |
| `printer.configuration_updated` | covered | API quando `print_mode` / `paper_width_mm` mudam |
| `backup.attestation_updated` | **NOT APPLICABLE** | attestação só via env (`BACKUP_*`); sem API de escrita |
| auth/security | covered | `security.access_denied` (+ whitelist `security.auth_failed`) |

Aliases de leitura: `normalizeAuditAction()` mapeia nomes de domínio → contrato B28 na API.

## Writer genérico (`record_audit_event`)

Whitelist (não inventa `sale.created` no writer genérico — vendas ficam nos RPCs de domínio):

- `security.access_denied`, `security.auth_failed` — qualquer membro da loja
- `audit.listed`
- `settings.updated`
- `printer.configuration_updated`
- `backup.attestation_updated` (reservado; sem caller hoje)
- `fiscal.issue_requested`, `fiscal.cancel_requested`

Ações privilegiadas (exceto `security.*`) exigem `user_can_view_reports` (manager/admin).
`security.access_denied` só aceita `result=denied`. Payload allowlist: `result`, `correlation_id`, `operation_id`, `metadata` (+ `actor_role` server-side). Cap ~8 KiB.

## Segredos / PII

Sanitização central: `sanitizeAuditMetadata()`.

Nunca registrar: password, JWT, refresh/access token, service_role, API key, CVV/PAN, credenciais fiscais/pagamento, webhook URL.

Minimizar PII: CPF/CNPJ, telefone, endereço, e-mail — preferir `customer_id` / flags (`has_document`).

`upsert_customer` (B28) grava apenas metadata com `customer_id` / `has_document` / `has_email` / `has_phone` — sem document/email/phone/nome.  
Linhas legadas podem ainda conter PII; a API de listagem re-sanitiza no read path.

Settings (B20): audit registra `actor`, timestamp (`occurred_at`), `field_changed` / diff seguro, `result`. Secrets e campos sensíveis (`document`, `phone`, `address_line`, …) entram só como nome do campo.

## Correlação

Quando disponível:

- `correlation_id` / `request_id` (header `x-correlation-id` / `x-request-id`)
- `operation_id` (operações fiscais/pagamento)

Fluxo típico: API → operação server → domínio/RPC → DB → outbox → audit.

IDs sensíveis de autoridade enviados pelo cliente são rejeitados; correlation é normalizado, não tratado como auth.

## API

`GET /api/admin/audit?store_id=…`

Obrigatório:

- autenticação
- RBAC (`canViewAuditLogs` → manager/admin)
- RLS / membership no RPC
- paginação (`limit` ≤ 100, default 25)
- filtros controlados: `action`, `resource_type`, `resource_id`, `actor`/`actor_user_id`, `result`, `from`, `to`
- ordenação fixa: `created_at DESC, id DESC`
- sem SQL arbitrário / sem tenant arbitrário / sem anônimo

## Performance

Índices:

- `(store_id, created_at DESC)`
- `(org_id, action, created_at DESC)`
- `(store_id, entity_type, entity_id, created_at DESC)`

Listagem sempre paginada; metadata truncada/sanitizada; sem N+1 na API admin.

## Retenção

```text
retention_policy = not_defined
```

Nenhuma exclusão automática de histórico no aplicativo. Não inventar obrigação legal.

## Resultados

`success` | `failure` | `rejected` | `denied`

O resultado descreve a operação **real** (ex.: request fiscal aceito ≠ documento autorizado pela SEFAZ).

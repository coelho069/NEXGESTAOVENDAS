# Assumptions — Sprint 1

Decisões assumidas para destravar o MVP. Revisar antes dos próximos sprints.

## Produto e locale

- Moeda única: **BRL** (`numeric(12,2)`).
- Timezone operacional: **America/Sao_Paulo**.
- UI inicial em pt-BR.

## Estoque

- Estoque negativo **bloqueado** no MVP.
- Quantidade fracionável até 3 casas (`numeric(12,3)`).
- Ajustes manuais de estoque fora do fluxo PDV Sprint 1 (tabela `inventory_movements` preparada).

## Pagamentos

- Checkout PDV Sprint 1: **somente dinheiro** via RPC.
- Cartão, Pix, voucher e outros métodos existem no enum, mas retornam adapter `not_configured` na API/RPC.
- Troco/cash drawer não modelado no Sprint 1.

## Fiscal

- NFC-e/SAT **fora** do Sprint 1.
- Toda venda confirmada gera registro `fiscal_documents` com `adapter=not_configured`.
- Interface de adapter criada para plug-in futuro.

## Auth e usuários

- Signup público desabilitado (`enable_signup=false` no Supabase config).
- Usuários demo criados via `pnpm seed:auth` com e-mails `@example.invalid`.
- `store_members.role` é a única autoridade de autorização, resolvida por `auth.uid()` + `store_id`.
- `profiles.default_role` permanece apenas como metadado/preferência informativa e nunca autoriza operações.
- JWT `user_metadata` não usado para RLS (somente tabelas app + `auth.uid()`).

## Sync / offline

- Fila local em IndexedDB; status local `pending` até RPC OK.
- Conflitos avançados (`sync_status=conflict`) reservados — flush simples no Sprint 1.
- Service worker registra tag de sync; flush principal via evento `online` no client.

## Segurança

- Role `anon` revogada em schema `public`.
- `SUPABASE_SERVICE_ROLE_KEY` apenas em scripts server-side (`seed:auth`).
- Vendas imutáveis via RLS; mutações comerciais via RPC auditável.

## Lojas demo

IDs fixos no seed para facilitar QA local:

- Org: `11111111-1111-4111-8111-111111111111`
- Loja Centro: `22222222-2222-4222-8222-222222222201`
- Loja Shopping: `22222222-2222-4222-8222-222222222202`

## Tipos TypeScript

- Gerados por `pnpm db:types`; snapshot versionado para CI sem Supabase local.

## Infra

- Supabase local requer Docker (não disponível neste ambiente de bootstrap).
- Deploy frontend compatível com Vercel; secrets via env server-only.

---

# Sprint 2

- Banco local Dexie `pdv_local_v1` substitui a fila `idb` do checkout; RPC Sprint 1 inalterada.
- Checkout é local-first: a venda fecha no IndexedDB mesmo online; o push usa `/api/sales/process`.
- Estoque local é projetado; `pullChanges` aplica saldo do servidor menos reservas `pending`/`processing`.
- Conflito 409/422 restaura estoque projetado e permanece visível na UI.
- Heartbeat e multi-tab lock são módulos distintos.
- Sem `NEXT_PUBLIC_*` com service role ou outros segredos.
- Cartão/Pix/NFC-e continuam `not_configured`.

---

# Sprint 3

- Interface PDV em 3 colunas no desktop e 2 regiões + sheet de pagamento no tablet.
- Regras de carrinho testáveis (`sale-ops`) com dinheiro em `decimal.js`.
- Desconto limitado por papel (caixa 5%, gerente 20%, admin até o subtotal).
- Pagamento falho / `not_configured` mantém rascunho local; recibo HTML inclui status de sincronização.
- Scanner HID não zera o carrinho. Busca textual é debounced.

---

# Sprint 4

- Quantidade de estoque só muda por movimento auditado (`adjust_inventory` / venda); CSV com relatório de erros.
- Dashboard SSR (COGS, margem, sell-through) com filtros de loja/período em `America/Sao_Paulo` e estado degradado.
- RBAC no servidor (RLS + RPC). Caixa não vê relatórios nem custo. `PermissionGate` é só UX.
- Manager entra no seed (`manager@example.invalid`).
- NFC-e, banco real e estorno continuam fora.

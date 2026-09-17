# AUDITADORIA ADVERSARIAL — NEX Gestão Vendas
**Data**: 2026-09-02 | **Analista**: Agente goose (Eng. Software Sênior / Segurança)  
**Metodologia**: Análise estática exclusiva de código-fonte, migrations, testes e arquitetura.  
**Restrição**: Nenhuma execução externa, nenhum navegador, nenhum ambiente de produção.  
**Referência**: AGENTS.md, docs/IMPLEMENTATION_CONTRACT.md, docs/assumptions.md.

---

## [STATUS GERAL]

**Nível de Risco: MODERADO-ALTO** — O repositório demonstra maturidade arquitetural sólida em isolamento de domínio, uso rigoroso de `decimal.js`, e defesa em profundidade em validações de entrada. Entretanto, a auditoria identificou **1 falha confirmada** (inconsistência crítica de papel entre cliente e servidor), **2 falhas prováveis** (race condition no lock multiplataforma e exposição acidental de esquema legado), **2 riscos teóricos** (contorno de RLS via view e grants excessivamente amplos), e **5 validações não executadas** essenciais para integridade financeira e de estoque em produção.

---

## [1. FALHAS CONFIRMADAS]

### F-01 — Inconsistência crítica de papel (role) entre client-side e server-side
- **Severidade**: CRÍTICA — Compromete a integridade do RBAC.
- **Local**: `src/lib/auth/session.ts` vs `src/lib/auth/authorization.ts` vs `src/lib/domain/rbac.ts`.
- **Detalhe**:
  - `getAuthedContext()` resolve o papel do usuário via `profiles.default_role` (tabela `profiles`).
  - Todas as funções de autorização server-side (`user_can_manage_inventory`, `user_can_view_reports`, `assert_sale_discount_cap`, `user_store_role`) leem o papel via `store_members.role`.
  - O cliente (`useCheckout`, `usePdvSale`) usa o papel de `getAuthedContext()` para decisões de UI e para chamar `salePayloadExceedsDiscountCap`. O servidor aplica o papel de `store_members`.
  - Se `profiles.default_role = 'manager'` mas `store_members.role = 'cashier'`, o cliente mostrará controles de gerente (desconto de 20%, botões de ajuste de estoque) mas o servidor rejeitará com `forbidden_store` / `discount_limit_exceeded`. O inverso também é possível: um caixa veria UI restrita mas teria permissão real no servidor.
- **Impacto**: O `PermissionGate` é explicitamente documentado como "UX-only", mas a inconsistência de papel significa que a UX e o servidor discordam sistematicamente sobre permissões. Isso viola o princípio de que a camada de acesso server-side é a única fonte de verdade.
- **Evidência**: Linhas em `session.ts` (`profile?.default_role`), `authorization.ts` (`store_members.role`), `rbac.ts` (`canViewReports(role)`), `process_sale_rpc.sql` (`user_store_role`), `security_hardening.sql` (`user_store_role(p_store_id) IN ('admin', 'manager')`).

---

## [2. FALHAS PROVÁVEIS]

### F-02 — Race condition TOCTOU no fallback localStorage do multi-tab lock
- **Severidade**: ALTA — Permite deduplicação de estoque e vendas concorrentes entre abas.
- **Local**: `src/lib/offline/multi-tab-lock.ts` — função `withLocalStorageLock`.
- **Detalhe**:
  - O fluxo é: (1) ler `localStorage[lockKey]`, (2) verificar se `expiresAt > now`, (3) escrever novo registro, (4) re-verificar se o owner ainda é o mesmo.
  - O passo crítico é a janela entre (1) e (3): duas abas podem simultaneamente ler o lock como expirado, ambas escreverem seus próprios owners, e apenas uma "ganhar". A verificação final (`parseLockRecord(...)?.owner !== owner`) detecta a perda, mas não impede que ambas tentem executar a seção crítica.
  - O `navigator.locks.request` é seguro (API atômica do navegador), mas o fallback localStorage **não é**. Em navegadores que não suportam `navigator.locks` (ex: Safari < 17.4 em certos modos, WebViews), o código cai no localStorage.
  - O `withCheckoutLock` no `use-checkout.ts` usa `withMultiTabLock` com lockName `nex-pdv-checkout:${storeId}`. Se dois tabs processarem checkouts simultaneamente, ambos poderiam deduzir estoque local e criar outbox commands, resultando em potencial double-deduction server-side (mitigado por `pg_advisory_xact_lock` + `FOR UPDATE` no servidor, mas não no cliente).
- **Evidência**: `multi-tab-lock.ts` linhas 56-90 (leitura-verificação-escrita sem atomicidade), `use-checkout.ts` linha 23 (`withCheckoutLock`).

### F-03 — Esquema legado `process_sale_live.sql` presente no repositório sem proteção adequada
- **Severidade**: ALTA — Risco de deploy acidental com schema incompatível.
- **Local**: `/home/ubuntu/NEXGESTAOVENDAS/supabase/process_sale_live.sql`.
- **Detalhe**:
  - O arquivo contém uma função `process_sale` com `SECURITY INVOKER` (não `SECURITY DEFINER`), que não verifica estoque (`stock` não é decrementado), cria "Stub Local" para produtos, e usa um schema de tabela `products` incompatível (`store_id`, `price`, `stock` vs `org_id`, `unit_price`, `cost_price`).
  - O comentário diz "NON-EXECUTABLE ARCHIVE" e "Do not add this file to the 20250901* migration chain", mas o arquivo está no diretório `supabase/` ao lado das migrations canônicas, sem mecanismo de proteção que impeça execução acidental (ex: via `supabase db reset` se o caminho for mal referenciado, ou via copy-paste em SQL Editor).
  - Se executado, o schema resultante seria totalmente inconsistente: tabelas `products` sem `org_id`, sem `inventory_balances` funcionais, sem RLS, sem `sale_idempotency_keys`.
- **Evidência**: `supabase/process_sale_live.sql` inteiro.

---

## [3. RISCOS TEÓRICOS]

### R-01 — `security_invoker = true` na view `analytics.product_period_metrics` dentro de função SECURITY DEFINER
- **Severidade**: MÉDIA — Contorno potencial de RLS em tabelas subjacentes.
- **Local**: `supabase/migrations/20250901000005_sprint4_inventory_dashboard_rbac.sql`.
- **Detalhe**:
  - A view `analytics.product_period_metrics` é criada com `WITH (security_invoker = true)`.
  - A função `get_dashboard_metrics` é `SECURITY DEFINER`, executando com privilégios do owner.
  - Em PostgreSQL, `security_invoker = true` faz a view verificar permissões usando o papel do **invocador** da query. Dentro de uma função SECURITY DEFINER, o "invocador" é o owner da função, não o usuário autenticado.
  - Se o owner da função tem acesso total (ex: role de migration), as políticas RLS nas tabelas `sales`, `sale_items`, `products` seriam efetivamente **bypassadas** para essa view.
  - **Mitigação atual**: `get_dashboard_metrics` filtra explicitamente por `m.org_id = public.current_user_org_id()` e `m.store_id = v_store_id`. Mesmo sem RLS, o filtro org limita os dados. Porém, um erro de digitação ou futuro refactoring que remova o filtro org poderia vazar dados de outras organizações.
  - **Recomendação**: Considerar `security_invoker = false` (padrão) para que a view use as permissões do owner, que é um administrador de schema, combinado com o filtro explícito. Ou criar a view no schema `analytics` com `security_invoker = false` e garantir que o owner tenha acesso adequado.

### R-02 — Grants excessivamente amplos combinados com dependência total de RLS
- **Severidade**: MÉDIA — Superfície de ataque aumenta se política RLS for omitida acidentalmente.
- **Local**: `supabase/migrations/20250901000003_rls_policies.sql` e `20260902150536_security_hardening.sql`.
- **Detalhe**:
  - `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated` dá permissões totais a todos os usuários autenticados em todas as tabelas.
  - A segurança depende **exclusivamente** das políticas RLS. Se uma nova tabela for adicionada sem políticas RLS (ou se uma política for acidentalmente droppada), authenticated terá acesso irrestrito.
  - O hardening mitiga parcialmente com `REVOKE CREATE ON SCHEMA public FROM PUBLIC`, `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`, e o drop de policies de insert/update/delete em `audit_logs`, `profiles`.
  - Entretanto, o `GRANT` amplo permanece como "backdoor" conceitual.
  - **Recomendação**: Restringir grants por tabela (ex: `GRANT SELECT ON inventory_balances TO authenticated` já é implícito pela política RLS; grants explícitos apenas para as colunas necessárias).

---

## [4. VALIDAÇÕES NÃO EXECUTADAS]

### V-01 — Teste de carga/concorrência no `process_sale` com `pg_advisory_xact_lock`
- **Não executado**: Não há teste unitário, integração ou e2e que simule múltiplos clients submetendo o mesmo `clientMutationId` simultaneamente.
- **Risco**: O `pg_advisory_xact_lock` e o `FOR UPDATE` em `sale_idempotency_keys` + `sales` são os únicos mecanismos de serialização. Sem teste de concorrência, não se pode garantir que não haja race condition que permita double-deduction de estoque.

### V-02 — Teste do trigger `assert_sale_payment_cardinality` (constraint trigger)
- **Não executado**: Nenhum teste verifica que o trigger impede insert/update de sales sem exatamente 1 pagamento ou delete de payments que resultaria em 0 pagamentos.
- **Risco**: A cardinalidade 1 venda = 1 pagamento é um invariantes financeiro crítico. Se o trigger falhar silenciosamente (ex: erro de configuração em produção), vendas poderiam ter 0 ou N pagamentos.

### V-03 — Teste do fallback `navigator.locks` → localStorage
- **Não executado**: Não há teste que simule navegadores sem `navigator.locks` para verificar o comportamento do lock localStorage e a TOCTOU race condition identificada em F-02.

### V-04 — Verificação de deploy acidental de `process_sale_live.sql`
- **Não executado**: Não há CI/CD ou script que verifique se arquivos incompatíveis foram acidentalmente incluídos em pipelines de deploy.
- **Risco**: Se `process_sale_live.sql` for incluído no chain de migrations (ex: por convenção de numeração ou copy-paste), o schema seria corrompido.

### V-05 — Verificação de consistência cross-tab em `closeSale` via IndexedDB
- **Não executado**: Não há teste que simule dois tabs abertos processando vendas para o mesmo `storeId` com produtos de estoque limitado, verificando se o `multi-tab-lock` + `withCheckoutLock` + `Dexie.transaction` impede double-deduction.
- **Risco**: O `closeSale` faz uma transação Dexie que inclui dedução de estoque. Se dois tabs bypassarem o lock (ex: `navigator.locks` indisponível), ambos poderiam deduzir estoque local, e o servidor resolveria via `pg_advisory_xact_lock` — mas um dos clients teria estoque local incorreto até o próximo pull.

---

## [5. INTEGRIDADE DA VENDA]

### Fluxo de venda (fechamento → processamento → reconciliação)

**Caminho feliz (online)**:
1. `useCheckout.paySale` → `validateSale` → `withCheckoutLock` → `closeSale`
2. `closeSale`:
   - `assertCashOnlyAndNoSecrets` — rejeita não-cash e segredos.
   - `validateSaleAmounts` — validação completa de preços, descontos, duplicatas.
   - Dexie `transaction("rw", [sales, saleItems, payments, inventoryBalances, outbox])`:
     - Deduz estoque local (`inventoryBalances.put`).
     - Insere sale (`status: "pending_sync"`, `syncStatus: "pending"`, `stockReconciled: false`).
     - Insere saleItems.
     - Insere payment (`status: "pending"`).
     - Insere outbox command (`status: "pending"`).
   - Retorna `{ saleId, clientMutationId, duplicate: false }`.
3. `flushPending` → `runSyncCycle` → `pushPendingCommands` → `pushOutboxCommand`.
4. `claimOutboxProcessing` (otimistic lock via `updatedAt`).
5. `fetch` → `POST /api/sales/process` com payload Zod-validado.
6. API route `/api/sales/process`:
   - Valida `processSaleInputSchema` (inclui `.superRefine` para duplicate products).
   - Verifica `hasNonCash`.
   - Verifica `salePayloadExceedsDiscountCap`.
   - Chama `supabase.rpc("process_sale", { p_payload })`.
7. `process_sale` (wrapper) → `assert_sale_payload_integrity` → `assert_sale_discount_cap` → `process_sale_core`.
8. `process_sale_core`:
   - `auth.uid()` verificado.
   - `user_has_store_access` verificado.
   - Idempotência: busca `(store_id, client_mutation_id)` em `sale_idempotency_keys` com `FOR UPDATE`, depois em `sales` com `FOR UPDATE`.
   - Se existente e `sale_payload_matches` → retorna replay.
   - `pg_advisory_xact_lock` para serialização por `(store_id, client_mutation_id)`.
   - `FOR UPDATE` em `inventory_balances` para lock de estoque.
   - Dedução atômica: `UPDATE inventory_balances SET quantity = quantity - v_qty`.
   - Insere sale, sale_items, inventory_movements, payments, fiscal_documents, audit_logs.
   - Retorna `{ sale_id, replay: false, status: "confirmed", total }`.
9. `reconcileSale`: marca sale como confirmed, outbox como synced, payments como captured, esconde conflitos.

**Caminho offline**:
1. Mesmo fluxo, mas `navigator.onLine === false`.
2. `closeSale` ainda deduz estoque local e cria outbox.
3. `flushPending` é pulado; `refreshSyncUi` atualiza o badge.
4. Ao voltar online, `flushPending` dispara o sync.
5. Se o servidor rejeita (ex: estoque insuficiente porque outro cliente vendeu):
   - `recordConflict` → status "conflict", `restoreProjectedInventory` restaura o estoque local.
   - Ou `markProcessingCommandFailed` → status "failed", `restoreProjectedInventory` restaura estoque.

**Avaliação**: O fluxo é bem projetado com defesa em profundidade (3 camadas de validação: Zod, API route, RPC server-side). O invariantes 1 venda = 1 pagamento é reforçado por:
- `processSaleInputSchema.payments.length(1)`
- `assert_sale_payload_integrity` verifica exatamente 1 pagamento cash
- `assert_sale_payment_cardinality` constraint trigger no banco

**Fragilidade**: O `reconcileSale` não restaura estoque local em caso de sucesso — mas isso é correto, pois o estoque já foi deduzido em `closeSale` e o servidor também deduziu. Porém, se `process_sale_core` falhar **após** inserir o sale mas **antes** de inserir payments, a trigger `assert_sale_payment_cardinality` reverteria a transaction (pois é `DEFERRABLE INITIALLY DEFERRED`). Isso é correto. Porém, o outbox command permanece em "pending" e seria reprocessado, levando a um replay do idempotency key.

---

## [6. OFFLINE / SYNC]

### Sync Engine (`src/lib/offline/sync-engine.ts`)

**Idempotência via clientMutationId**:
- O `clientMutationId` é um UUID gerado no `beginCheckout` e persistido no `useCartStore`.
- `assertImmutableClientMutationId` impede que o ID seja alterado durante retry.
- No servidor, `sale_idempotency_keys` tem chave primária `(store_id, client_mutation_id)`.
- A query no servidor busca `FOR UPDATE` primeiro em `sale_idempotency_keys`, depois em `sales`.
- `sale_payload_matches` compara o payload completo para detectar replay malicioso.

**Atomicidade offline-to-online**:
- `closeSale` usa Dexie `transaction("rw", ...)` que engloba sales, saleItems, payments, inventoryBalances, outbox. Se qualquer operação falhar, a transação é revertida.
- `claimOutboxProcessing` usa `db.transaction("rw", db.outbox, ...)` com verificação de `updatedAt` para optimistic locking.
- `pushOutboxCommand` usa `claimOutboxProcessing` que é atômico — ou claima ou retorna null.

**Race conditions identificadas**:
1. **Double-submit entre abas**: Se `navigator.locks` não está disponível, o `withLocalStorageLock` tem TOCTOU. Dois tabs podem chamar `closeSale` simultaneamente, ambos deduzindo estoque local, ambos criando outbox commands diferentes para o mesmo clientMutationId? Não — o `closeSale` verifica se já existe sale/outbox com o mesmo `clientMutationId` no Dexie transaction. Mas se os tabs têm IndexedDB separados (navegadores diferentes ou perfis diferentes), o lock local não protege.
   - **Nota**: IndexedDB é por origem (origin + profile), então dois tabs do mesmo navegador compartilham o mesmo IndexedDB. A transação Dexie é atômica dentro da mesma origem. O problema é apenas o lock multiplataforma.

2. **Restauração de estoque em conflict/failure**: `restoreProjectedInventory` computa `reservedQty` de todas as vendas ativas EXCETO a venda corrente. Se uma venda falha e é excluída do cálculo de reserva, o estoque é restaurado corretamente. Porém, `restoreProjectedInventory` só é chamada em `recordConflict` e `markProcessingCommandFailed`. Se o servidor retornar um erro HTTP 500 que não seja classificado como `conflict` ou `transient`, o `markProcessingCommandFailed` é chamado — mas o `outcomeUnknown` flag e o `markProcessingCommandUncertain` tratam o caso de resposta ambígua.

**Inventário local vs servidor**:
- `applyPulledChanges` atualiza local inventory balances do servidor: `quantity = Math.max(0, serverQuantity - reservedQty)`.
- `canReconcileSaleStock` verifica se `Date.parse(row.updated_at) >= saleUpdatedAt` antes de reconciliar — ou seja, só reconcilia se o servidor teve uma atualização de estoque mais recente que a venda. Isso evita sobrescrever deduções locais com dados antigos do servidor.
- **Fragilidade**: Se `canReconcileSaleStock` retornar `false` (por ex., porque a atualização do servidor é mais antiga), a venda permanece com `stockReconciled: false`, e o estoque local deduzido permanece. Na próxima sincronização, se o servidor ainda não atualizou, o estoque local ficará inconsistente com o servidor indefinidamente.

---

## [7. SEGURANÇA]

### RLS — Row Level Security
- **Estado**: Habilitado em todas as 14 tabelas.
- **anon revogado**: `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon`. Nenhum acesso anônimo.
- **authenticated**: `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES` — amplo, mas mitigado por RLS policies.
- **Policies críticas**:
  - `sales`: apenas SELECT (INSERT/UPDATE/DELETE bloqueados por RLS — sem policy de escrita). Vendas só podem ser criadas via RPC.
  - `sale_items`: apenas SELECT (via subquery em sales).
  - `payments`: apenas SELECT (via subquery em sales).
  - `inventory_balances`: apenas SELECT. Escrita apenas via RPC (`adjust_inventory`, `process_sale`).
  - `sale_idempotency_keys`: `sale_idempotency_deny` — deny ALL para authenticated.
  - `audit_logs`: INSERT apenas via policy `audit_logs_insert`. Mas o hardening migration droppou essa policy e revogou INSERT — audit logs só podem ser criados por funções SECURITY DEFINER.
  - `profiles`: UPDATE dropado — perfis não podem ser atualizados diretamente.

**Problema identificado**: A policy `sales_select` usa `public.user_has_store_access(store_id)`. A função `user_has_store_access` foi redefinida no hardening migration para incluir `s.org_id = sm.org_id` — verificando que o membro pertence à mesma org da store. Isso prevê que um usuário de outra org não possa acessar stores de terceiros. **Correto**.

### RBAC
- **Admin**: full access a produtos, categorias, relatórios, inventário.
- **Manager**: acesso a produtos (CRUD), categorias (CRUD), relatórios, inventário (ajustes). NÃO pode deletar produtos ou categorias.
- **Cashier**: SELECT ativo em produtos, sem acesso a custo, sem relatórios, sem ajustes de estoque, desconto máximo de 5%.
- **Column-level grant**: `REVOKE SELECT ON public.products FROM authenticated; GRANT SELECT (id, org_id, ..., unit_price, ...)` — oculta `cost_price` do caixa.

**Fragilidade**: O `getAuthedContext` no cliente retorna o papel de `profiles.default_role`. O servidor usa `store_members.role`. Se o cliente informa "manager" mas o servidor tem "cashier", o cliente enviaria requests de desconto de 20% que o servidor rejeitaria. Isso é uma falha UX, não de segurança, mas gera confusão e potencial para erros de negócio.

### Segurança server-side dos RPCs
- Todos os RPCs são `SECURITY DEFINER`.
- Todos os RPCs verificam `auth.uid()` no início.
- `process_sale` verifica `user_has_store_access`, `user_store_role`, `assert_sale_discount_cap`.
- `adjust_inventory` verifica `user_can_manage_inventory`, `user_store_role`.
- `get_dashboard_metrics` verifica `user_can_view_reports`.
- `get_inventory_page` verifica `user_has_store_access`.

**Problema**: O `current_user_org_id()` função é `SECURITY DEFINER` e retorna o org do perfil. Se o perfil for deletado ou tiver org_id errado, todas as RLS policies falham. Não há fallback nem audit logging para esse caso.

### Fiscal
- `fiscal_documents` table tem status `not_configured` por padrão.
- `NotConfiguredFiscalAdapter` é o único adapter implementado.
- A trigger `assert_sale_payment_cardinality` não interfere em fiscal documents.
- **Status**: Fora do escopo do Sprint 4 (NFC-e/SAT). Nenhum risco fiscal identificado para o MVP.

---

## [8. TOP 5 RISCOS]

| # | Risco | Severidade | Tipo | Mitigação Atual | Ação |
|---|-------|-----------|------|-----------------|------|
| 1 | **Inconsistência de papel cliente/servidor** (F-01) | CRÍTICA | Segurança | PermissionGate é UX-only | Alinhar `getAuthedContext` com `store_members.role` ou criar função server-side `resolve_role` chamada por ambos |
| 2 | **Race condition TOCTOU no lock localStorage** (F-02) | ALTA | Concorrência | `navigator.locks` como primary | Adicionar fallback mais robusto (ex: `localStorage` + `BroadcastChannel` para coordenação entre tabs) ou documentar que funciona apenas com `navigator.locks` |
| 3 | **`process_sale_live.sql` exposto no repositório** (F-03) | ALTA | Deploy acidental | Comentário "NON-EXECUTABLE ARCHIVE" | Mover para `docs/legacy/` ou `.gitignore`, ou criar script de CI que verifica arquivos `.sql` fora de `supabase/migrations/` |
| 4 | **view `analytics.product_period_metrics` com `security_invoker = true`** (R-01) | MÉDIA | RLS bypass | Filtro explícito por `org_id` | Alterar para `security_invoker = false` e garantir que o owner tenha acesso às tabelas |
| 5 | **Sem testes de concorrência ou carga** (V-01, V-02, V-05) | MÉDIA | Não verificado | Nenhum | Criar testes de integração que simulem múltiplos clients, testar o trigger de cardinalidade de pagamentos, e testar o fallback do lock |

---

## [9. ÚNICA PRÓXIMA AÇÃO RECOMENDADA]

**Ação prioritária única**: Corrigir a inconsistência de papel entre client-side e server-side (F-01).

**Justificativa**: Esta é a única falha **confirmada** com impacto direto na integridade financeira e operacional. Se um caixa tem `profiles.default_role = 'manager'` mas `store_members.role = 'cashier'`, o sistema permitirá UI de desconto de 20% mas o servidor rejeitará — ou vice-versa. Isso afeta todos os controles de acesso e pode mascarar a própria existência do bug.

**Passos concretos**:
1. **Eliminar `profiles.default_role` como fonte de verdade** para permissões de operação (vendas, estoque, relatórios). O `profiles.default_role` pode permanecer como metadado de cadastro, mas não como fonte de autorização em tempo de execução.
2. **Criar função server-side `resolve_current_user_store_role(p_store_id uuid)`** que retorne o papel efetivo do usuário na loja, combinando `store_members.role` com fallback para `profiles.default_role` apenas se não houver membership.
3. **Substituir `getAuthedContext().role`** em todos os hooks e componentes client-side por uma chamada ao novo RPC ou ao resultado de `resolveStoreRole` do `src/lib/auth/authorization.ts`.
4. **Testar explicitamente** o cenário onde `profiles.default_role != store_members.role` para garantir que o servidor prevalece e a UI reflete a decisão server-side.

**Ações subsequentes** (em ordem de prioridade):
- Mover `process_sale_live.sql` para `docs/legacy/` ou remover do repositório.
- Implementar teste de carga no `process_sale` com `pg_advisory_xact_lock`.
- Adicionar teste do trigger `assert_sale_payment_cardinality`.
- Melhorar o fallback do multi-tab lock (adicionar `BroadcastChannel` ou `SharedWorker` para coordenação entre tabs).
- Corrigir `security_invoker = true` na view `analytics.product_period_metrics`.
- Restringir grants de authenticated por tabela/coluna ao invés de grants amplos.

---

*Fim do relatório de auditoria. Todas as conclusões baseiam-se exclusivamente em análise estática de código-fonte, migrations SQL, arquivos de teste e documentação presente no repositório. Nenhuma execução de código, conexão com banco de dados ou teste de integração foi realizada.*

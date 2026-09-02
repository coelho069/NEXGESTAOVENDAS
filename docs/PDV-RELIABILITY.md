# Auditoria de Confiabilidade — Núcleo Transacional do PDV

**Data:** 2026-09-02  
**Escopo:** fluxo de venda cash local-first, do carrinho ao Postgres, incluindo alterações não commitadas do working tree.  
**Diagnosis Status:** **BLOCKED — runtime PostgreSQL/Supabase indisponível para validação**
**Nota de confiança:** **BAIXA — validação de banco bloqueada; não aprovado para produção**.
**RBAC:** `store_members.role` é a autoridade única por loja; `profiles.default_role` é somente informativo.

## 1. Conclusão executiva

O fluxo local possui uma fronteira transacional consistente: `closeSale` grava venda, itens, pagamento, reserva de estoque e outbox na mesma transação Dexie. O sync usa a mesma chave `clientMutationId`, reivindicação compare-and-set, timeout e backoff. O servidor possui RPC transacional com locks de estoque e, na migration de hardening, lock advisory por `(store_id, client_mutation_id)`.

Esta auditoria identificou e corrigiu inconsistências de fronteira:

1. O caminho local aceitava somente um pagamento cash, mas a API/RPC ainda permitia vários pagamentos cash para uma mesma venda.
2. A validação Zod restringia precisão e formato, mas uma chamada autenticada direta à RPC podia chegar ao core com quantidade/preço sujeitos a cast ou arredondamento implícito.
3. Respostas 2xx com `sale_id` inválido poderiam reconciliar uma venda como confirmada.
4. O wrapper usava acumuladores limitados a `numeric(12,2)` e funções `SECURITY DEFINER` sem `pg_temp` explicitamente no fim do `search_path`.
5. A cardinalidade de pagamentos não tinha uma proteção deferida no banco para escritas privilegiadas fora da RPC.
6. O sync podia liberar uma reserva após confirmação local, descontar duas vezes no pull ou perder consistência após resposta remota ambígua.

O replay agora compara o payload recebido com venda, itens, pagamentos e totais persistidos. Payloads alterados com o mesmo `clientMutationId` são rejeitados como conflito.

A autorização foi alinhada ao mesmo princípio: a sessão e as rotas SSR resolvem
`auth.uid()` + `store_id` contra `store_members.role`, sem fallback para
`profiles.default_role`. A migration incremental remove as policies históricas que
mantinham esse fallback e aplica a mesma regra ao `adjust_inventory`.

A validação permanece bloqueada porque não foi possível executar migrations, RPC, RLS ou concorrência real do Postgres: o ambiente não possui Docker/Podman nem `psql`. A suíte E2E também não possui sessão autenticada; somente os cenários públicos passam.

## 2. Fluxo auditado

```text
Zustand/localStorage
  carrinho, desconto, cliente, tentativa de checkout
            │
            ▼
sale-ops
  Decimal, estoque projetado, descontos, total determinístico
            │
            ▼
useCheckout + adapter cash
  bloqueio de clique duplo, clientMutationId estável
            │
            ▼
closeSale — transação Dexie rw
  sales + saleItems + payments + inventoryBalances + outbox
            │
            ▼
outbox
  claim CAS → processing → retry/conflict/failed/synced
            │
            ▼
POST /api/sales/process
  sessão + membership + Zod + limite de desconto
            │
            ▼
public.process_sale
  validação do wrapper + advisory lock + replay
            │
            ▼
process_sale_core — transação PostgreSQL
  sales + idempotency key + sale_items + payments
  inventory_balances + inventory_movements
  fiscal_documents + audit_logs
            │
            ▼
reconcileSale
  venda confirmed/synced, pagamento captured
```

Estados relevantes:

| Estado | Representação | Efeito |
|---|---|---|
| Aguardando pagamento | adapter `not_configured` / carrinho | Não grava venda nem baixa estoque |
| Pendente de sincronização | venda `pending_sync`, outbox `pending` | Reserva estoque projetado; retry permitido |
| Em processamento | outbox `processing` | Uma aba possui o comando via CAS |
| Confirmada | venda `confirmed`, sync `synced`, pagamento `captured` | Reserva local reconciliada |
| Conflito | outbox/venda `conflict` | Não reenviar automaticamente; reserva restaurada e conflito visível |
| Resultado remoto incerto | outbox/venda `conflict`, `outcomeUnknown=true` | Não criar nova operação; reserva e pagamento pendente ficam preservados até pull autoritativo |
| Erro de persistência | sync `failed`, pagamento `failed` | Não reenviar; reserva local restaurada |

## 3. Matriz de invariantes

| Invariante | Evidência | Resultado |
|---|---|---|
| 1 venda local = 1 pagamento lógico cash | `closeSale` exige exatamente um pagamento; schema Zod usa `.length(1)`; wrapper SQL rejeita quantidade diferente de um | **Implementado; RPC ainda requer execução real** |
| 1 venda persistida = exatamente 1 pagamento | constraint trigger deferida valida a cardinalidade no commit | **Implementado na migration; runtime pendente** |
| 1 venda lógica = 1 baixa de estoque | transação Dexie; `process_sale_core` trava saldo e grava movimento; duplicidade de produto é rejeitada | **Implementado em código** |
| 1 `clientMutationId` = 1 operação | índice local, chave única SQL, advisory lock, replay e CAS do outbox | **Implementado em código** |
| Replay com payload diferente é rejeitado | comparação de loja, operador da mutação, cliente, totais, itens e pagamentos | **Implementado; runtime SQL pendente** |
| Dinheiro é determinístico | `decimal.js`, strings BRL com duas casas, limites `numeric(12,2)` | **Implementado** |
| Quantidade não sofre arredondamento silencioso | escala máxima de três casas no schema, domínio e wrapper SQL | **Implementado; runtime SQL pendente** |
| Venda, pagamento e estoque locais são atômicos | única transação Dexie `rw` | **Comprovado por testes unitários** |
| Venda, pagamento e movimento server-side são atômicos | única RPC PL/pgSQL com locks e rollback transacional | **Não executado neste ambiente** |

Observação: uma venda com vários produtos gera um movimento de estoque por item no banco, mas todos pertencem à mesma operação transacional e ao mesmo `sale_id`.

## 4. Testes de confiabilidade executados

Os testes de stress abaixo são determinísticos e executados contra IndexedDB em `fake-indexeddb`; não substituem carga concorrente real de Postgres.

| Cenário | Cobertura | Resultado |
|---|---|---|
| Duas chamadas simultâneas com o mesmo `clientMutationId` | uma venda, um item, um pagamento, uma baixa | **PASS** |
| Duas vendas simultâneas com estoque unitário | uma confirma e outra falha; saldo não fica negativo | **PASS** |
| Clique duplo no hook de checkout | segundo checkout é rejeitado enquanto o primeiro está em voo | **PASS** |
| Reuso do ID com preço/payload diferente | fechamento local rejeita sem nova escrita | **PASS** |
| Reuso do ID com pagamento divergente | total é recalculado e rejeitado | **PASS** |
| Resposta 503 | backoff, comando permanece pendente e retry respeita `nextAttemptAt` | **PASS** |
| Timeout após processamento remoto simulado | `AbortController` expira a primeira entrega; segunda usa o mesmo ID e reconcilia como replay | **PASS** |
| Erro HTTP fatal | outbox/venda entram em `failed`, pagamento falha e estoque é restaurado | **PASS** |
| Dez falhas de transporte/resultado ambíguo | conflito incerto, reserva preservada e reconciliação posterior pelo pull | **PASS** |
| 2xx sem `sale_id` até esgotar retries | conflito incerto e reserva preservada até reconciliação | **PASS** |
| 2xx com `sale_id` inválido | retry seguro sem marcar venda como sincronizada | **PASS** |
| Falha parcial de persistência/quota | rollback após `saleItems`, `payments`, `outbox` e segunda baixa de estoque | **PASS** |
| Lock multi-tab | escopo por loja, TTL, heartbeat, lease expirado e remoção pelo owner | **PASS** |
| Resposta de conflito com lease antiga | CAS impede que uma resposta atrasada sobrescreva o processamento atual | **PASS** |
| RBAC divergente, sem membership e multi-store | role vem de `store_members.role` por loja; sem membership é negado | **PASS (unitário)** |
| Limites de dinheiro e quantidade | overflow de BRL, quatro casas de quantidade e múltiplos pagamentos rejeitados | **PASS** |
| Fluxo offline → outbox → sync | pagamento local pendente, retry e reconciliação | **PASS** |
| RPC/RLS Postgres real | concorrência, rollback, membership e isolamento tenant | **NÃO EXECUTADO** |
| E2E protegido | 9 cenários Playwright | **2 PASS / 7 FAIL** |

Comandos:

```text
pnpm test       PASS — 6 arquivos, 85 testes
pnpm typecheck  PASS
pnpm lint       exit 0 — 1 warning preexistente em inventory-screen.tsx
pnpm build      PASS
pnpm test:e2e   FAIL — 2 de 9 passaram; páginas protegidas redirecionaram para login
```

O E2E não falhou em uma asserção de venda: os testes protegidos não encontram `store-select`, headings de inventário ou dashboard porque não existe fixture de autenticação/storage state.

## 5. Correções aplicadas nesta auditoria

### 5.1 Fronteira financeira

**Causa raiz:** o contrato local já modelava uma operação cash única, mas `payments` era apenas `.min(1)` na entrada server-side e o core fazia loop sobre todos os pagamentos.

**Correção:**

- `processSaleInputSchema` exige exatamente um pagamento.
- `assert_sale_payload_integrity` na migration rejeita payload sem exatamente um pagamento cash.
- O valor do pagamento é comparado ao total recalculado antes do core.
- Uma constraint trigger deferida rejeita, no commit, qualquer venda persistida com zero ou mais de um pagamento.

### 5.2 Fronteira numérica server-side

**Causa raiz:** a API Zod não protege chamadas diretas ao RPC autenticado. Casts para `numeric(12,3)` poderiam arredondar quantidade com mais de três casas.

**Correção:**

- Wrapper SQL valida JSON, tipos, formato BRL, limites, quantidade, escala, item total e total da venda.
- Itens duplicados por produto são rejeitados.
- O `process_sale_core` existente não foi alterado; a contenção ocorre antes dele.

### 5.3 Replay e mismatch

**Causa raiz:** uma chave idempotente identifica uma operação, mas sem comparar o conteúdo poderia aceitar uma nova tentativa adulterada.

**Correção:**

- `sale_payload_matches` compara os dados canônicos persistidos com o payload recebido.
- API retorna HTTP 409 para `idempotency_payload_mismatch`.
- O lock advisory serializa retries concorrentes do mesmo par loja/mutação.

### 5.4 Respostas e segurança da função

**Causa raiz:** o sync tratava qualquer valor truthy como UUID de venda e as funções adicionadas pela migration deixavam o `search_path` implícito para objetos temporários.

**Correção:**

- `sale_id` é validado com `uuid.validate` antes da reconciliação.
- Acumuladores do wrapper usam `numeric` sem escala limitada até a validação final.
- Funções `SECURITY DEFINER` da migration usam `pg_catalog, public, pg_temp`.

### 5.5 Falhas terminais locais

**Causa raiz:** esgotar retry podia deixar venda `pending` e reserva local ativa.

**Correção validada:**

- Venda passa a `syncStatus=failed`.
- Pagamentos locais passam a `failed`.
- Estoque projetado é recalculado sem a reserva da venda terminal.
- O badge de sincronização diferencia `failed` de `pending`.
- A transição de `outbox`, venda, pagamento e reserva ocorre na mesma transação Dexie.

### 5.6 Resultado remoto incerto e estoque projetado

- Falhas de transporte, respostas 5xx e respostas 2xx sem `sale_id` permanecem como conflito incerto após o limite de retries.
- O pagamento continua `pending` e a reserva não é liberada até o pull confirmar a operação ou uma resolução operacional explícita.
- Vendas sincronizadas mantêm a reserva local até o estoque autoritativo ser observado no pull.
- O pull reconcilia a venda antes de calcular reservas e gravar o cursor, evitando dupla baixa e avanço de cursor sem reconciliação.
- Totais numéricos recebidos do servidor são normalizados para strings BRL antes de persistir no Dexie.

### 5.7 Concorrência entre abas

- Checkout usa lock `nex-pdv-checkout:<storeId>`; sincronização usa lock separado `nex-pdv-sync:<storeId>`.
- O fallback local usa owner, TTL, heartbeat e remoção condicional para não remover o lease de outra aba.
- O CAS do outbox continua sendo a segunda barreira para o mesmo `clientMutationId`.

### 5.8 Autoridade RBAC por loja

**Causa raiz:** a migration inicial e a sessão expunham `profiles.default_role`
como autoridade, permitindo divergência entre o papel global do perfil e o papel
da mesma pessoa em cada loja.

**Correção:**

- `getAuthedContext(storeId)` não lê `default_role` e resolve o papel via membership.
- Rotas, loaders e RPCs usam a membership específica da loja antes de gates de UX.
- A migration `20260902201000_rbac_store_membership_authority.sql` remove as
  policies históricas baseadas em perfil e recria helpers/policies com
  `store_members.role`.
- `adjust_inventory` grava `actor_role` exclusivamente da membership resolvida.

Os testes unitários cobrem divergência de papel, ausência de membership, duas
lojas e alteração dinâmica. RLS/RPC real continua pendente neste ambiente.

## 6. Riscos que permanecem

1. **Postgres não validado:** migration, RPC, advisory lock, replay e RLS precisam de execução contra Supabase local/integração.
2. **E2E sem identidade:** jornadas protegidas não são evidência de confiabilidade até receberem fixture autenticada.
3. **Carrinho e IndexedDB não são namespaced por usuário/organização:** logout ou troca de operador pode atribuir uma venda offline ao usuário que fizer o push.
4. **Fallback de lock em `localStorage`:** o checkout e o sync agora usam leases escopados por loja com TTL/heartbeat; a aquisição ainda não é compare-and-set atômica em browsers sem Web Locks.
5. **Resultado incerto exige reconciliação:** a reserva é preservada, mas ainda não existe uma ação operacional dedicada para consultar/reprocessar manualmente o mutation ID.
6. **Catálogo offline após reload:** uma nova venda não pode ser montada sem catálogo local.
7. **Pull sem paginação/high-water mark completo:** o payload agora é validado, mas volume acima do limite e snapshot consistente ainda precisam de evolução.
8. **Caixa físico não existe:** não há sessão, recebido, troco, gaveta ou conciliação; a garantia cobre apenas o registro lógico do pagamento.
9. **COGS histórico:** o custo ainda é derivado do preço atual do produto, não congelado no item da venda.

Nenhum desses riscos foi mascarado por desativação de teste ou fallback de produção.

## 7. Próxima tarefa recomendada

Subir Supabase local em Docker/CI e criar uma suíte de integração que:

1. aplique todas as migrations em banco limpo;
2. crie dois usuários, duas lojas e duas organizações;
3. execute duas chamadas concorrentes reais da RPC com o mesmo payload;
4. simule timeout após commit e repita o payload;
5. verifique uma única venda, pagamento, movimento e baixa;
6. tente payload mismatch, múltiplos pagamentos, escala inválida e acesso cross-tenant;
7. rode a fixture autenticada Playwright sobre o mesmo seed.

Até essa etapa, a recomendação técnica é **não promover o núcleo a produção**.

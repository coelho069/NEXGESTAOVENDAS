# Auditoria Técnica — Nex Gestão Vendas

**Data da auditoria:** 2026-09-02  
**Escopo:** estado efetivo do working tree em `/home/ubuntu/NEXGESTAOVENDAS`, incluindo alterações não commitadas.  
**Restrição observada:** nenhum arquivo de código, banco ou configuração foi alterado; este relatório é o único arquivo criado pela auditoria.

## 1. Resumo Executivo

O projeto é um MVP de PDV local-first com uma base técnica coerente para venda em dinheiro: Next.js App Router, Supabase/Postgres, RLS, RPC transacional `process_sale`, domínio monetário com `decimal.js`, IndexedDB via Dexie, outbox idempotente e UI de carrinho. A implementação local do fechamento da venda tem boa cobertura unitária e o build/typecheck estão verdes.

O estado real, entretanto, ainda não é seguro para evolução comercial sem correções prévias. Os principais riscos são:

1. **CRÍTICO — escalação de privilégio e isolamento de tenant:** `profiles_update_own` permite ao próprio usuário alterar `default_role` e `org_id`; as políticas e RPCs usam esses campos como fonte de autorização.
2. **ALTO — exposição de custo:** RLS é por linha, não por coluna. Um caixa autenticado com acesso direto a `products` pode selecionar `cost_price`, apesar de a UI e o contrato dizerem que esse dado é proibido.
3. **ALTO — sincronização offline incompleta:** não há cache local do catálogo, a primeira carga de estoque não propaga atualização para a UI e `lastPullAt` é global, não por loja/tenant.
4. **ALTO — atribuição de vendas offline:** o outbox não é vinculado ao usuário; após logout/login, outro operador pode enviar a venda e ela será gravada com o novo `auth.uid()`.
5. **ALTO — SQL operacional conflitante:** `supabase/process_sale_live.sql` descreve outro schema e pode sobrescrever a RPC canônica com `SECURITY INVOKER`.
6. **ALTO — contabilidade/estoque:** o dashboard calcula COGS usando o custo atual de `products`, não um custo congelado na venda; após dez falhas de sincronização, a reserva de estoque local não é liberada.
7. **ALTO — autorização/auditoria incompletas:** policies de categoria e audit log aceitam escrita direta mais ampla que o contrato.
8. **QA não confiável no estado atual:** `pnpm test:e2e` terminou com 7 falhas em 9 testes porque as páginas protegidas redirecionaram para login; não existe fixture de autenticação/storage state.

As partes mais estáveis são as regras puras de dinheiro/carrinho, o fechamento Dexie em transação única, a proteção de estoque negativo no fluxo SQL canônico, o retry com `clientMutationId` imutável e a sanitização do HTML do recibo. Essas conclusões são baseadas em código e testes locais; a RPC/RLS não foi executada contra um Postgres local nesta auditoria.

**Principal gargalo arquitetural:** o contexto de autorização, organização, loja e operador está fragmentado entre `profiles.default_role`, `store_members.role`, seletores de papel controlados pelo cliente, `localStorage` e um banco IndexedDB compartilhado. Não há uma fonte única de verdade que atravesse UI, persistência offline, sincronização e auditoria.

**Próxima tarefa recomendada:** corrigir e testar a autoridade server-side/RLS de identidade e tenant, começando por impedir a autoalteração de `profiles.default_role`/`profiles.org_id` e por criar testes de isolamento com usuário caixa, gerente e organizações distintas. Essa tarefa vem antes de novas features porque hoje a autorização pode ser escalada.

## 2. Stack e Arquitetura Atual

### 2.1 Estado do repositório

- Branch: `main`.
- HEAD versionado: `892f0c9 feat: add Sprint 4 inventory, SSR dashboard, and RBAC`.
- O working tree contém alterações não commitadas em documentação, configuração, dependências lockadas, APIs, domínio, hooks, offline, tipos e testes.
- Também há arquivos não rastreados relevantes: `eslint.config.mjs`, `src/lib/domain/catalog-load.ts`, `src/lib/domain/receipt-sync.ts`, `src/lib/pdv/fixtures.ts`, `supabase/migrations/20250901000006_sale_discount_cap.sql`, `supabase/process_sale_live.sql` e `tests/unit/sale-integrity.test.ts`.
- Portanto, o relatório descreve o **working tree atual**, não apenas o último commit.

### 2.2 Stack identificada

| Camada | Implementação | Evidência |
|---|---|---|
| Frontend | Next.js `16.3.4`, React `19.2.8`, App Router, TypeScript strict | `package.json:16-27`, `tsconfig.json:2-39` |
| Estilo | Tailwind CSS e CSS global | `package.json:42-45`, `src/app/globals.css` |
| Backend/BaaS | Supabase SSR/JS, Auth e Postgres | `package.json:17-18`, `src/lib/supabase/{client,server,middleware}.ts` |
| Domínio monetário | `decimal.js`, strings com duas casas | `package.json:19`, `src/lib/money.ts:1-35` |
| Estado de UI | Zustand; carrinho persistido | `src/stores/cart-store.ts:30-88`, `src/stores/pdv-ui-store.ts:24-36` |
| Offline | Dexie `pdv_local_v1` sobre IndexedDB | `src/lib/offline/pdv-local-db.ts:23-69`, `src/lib/offline/types.ts:4-124` |
| Validação | Zod nas rotas | `src/lib/validation/schemas.ts:5-111`, rotas em `src/app/api` |
| Testes | Vitest/jsdom/Testing Library e Playwright Chromium | `vitest.config.ts:1-17`, `playwright.config.ts:1-22` |
| Pacote | pnpm | `package.json:5-14`, `pnpm-workspace.yaml` |

O `README.md:7` ainda informa Next.js 14, enquanto o código executado pelo build é Next.js 16.3.4. O build também reporta que a convenção `middleware` está depreciada em favor de `proxy` (`src/middleware.ts`).

### 2.3 Separação de camadas

Há separação razoável entre:

- UI: `src/components`, `src/app`;
- hooks/stores: `src/hooks`, `src/stores`;
- domínio puro: `src/lib/domain`, `src/lib/money.ts`;
- offline: `src/lib/offline`;
- integração Supabase: `src/lib/supabase`, `src/lib/server`;
- adapters: `src/lib/adapters`;
- banco: `supabase/migrations`.

O fluxo de checkout é um ponto de acoplamento inevitável, mas concentrado em `src/hooks/use-checkout.ts`, que coordena adapter, domínio, Dexie, outbox e sincronização. As rotas mantêm validação e autorização server-side antes de chamar Supabase.

O worker está em `src/workers/sync-worker.ts`, mas não há registro do worker no código (`navigator.serviceWorker.register(...)` não aparece no projeto). O provider apenas adiciona listener a `navigator.serviceWorker`, portanto o Background Sync descrito na documentação não é executável como instalado.

### 2.4 Rotas observadas

O build de produção listou:

| Rota | Tipo | Responsabilidade |
|---|---:|---|
| `/` | estática | entrada |
| `/login` | estática | login Supabase |
| `/auth/callback` | estática | redireciona para `/pdv` |
| `/pdv` | estática | tela de venda |
| `/inventory` | dinâmica | SSR inicial de inventário |
| `/dashboard` | dinâmica | SSR inicial de métricas |
| `POST /api/sales/process` | dinâmica | envio da venda para `process_sale` |
| `GET /api/sync/changes` | dinâmica | pull de estoque/vendas |
| `POST /api/inventory/adjust` | dinâmica | `adjust_inventory` |
| `POST /api/inventory/import` | dinâmica | CSV linha a linha |
| `GET /api/inventory/list` | dinâmica | `get_inventory_page` |
| `GET /api/inventory/export` | dinâmica | CSV de `get_inventory_page` |
| `GET /api/dashboard/metrics` | dinâmica | `get_dashboard_metrics` |
| `POST /api/products` | dinâmica | criação de produto |
| `PATCH /api/products/[id]` | dinâmica | alteração de produto |
| `GET /api/auth/session` | dinâmica | perfil mínimo da sessão |

Evidência do mapa: saída de `pnpm build`; implementações em `src/app/api/**/route.ts`.

### 2.5 Persistência

Existem dois modelos independentes:

1. **Postgres:** fonte autoritativa de vendas confirmadas, pagamentos, estoque, movimentos, auditoria e fiscal.
2. **IndexedDB:** venda local pendente, itens, pagamentos, estoque projetado, outbox, conflitos e metadados.

O catálogo e os clientes não possuem stores locais equivalentes. Isso limita o significado de “offline-first”: a mutação da venda é local-first, mas a capacidade de montar uma nova venda após reload offline não é.

## 3. Tabela de Funcionalidades

| Funcionalidade | Estado | Evidência | Dependências | Risco |
|---|---|---|---|---|
| Login por e-mail/senha | IMPLEMENTADO MAS INCOMPLETO | `src/components/auth/login-form.tsx:7-29` chama `signInWithPassword`; `supabase/config.toml:19-29` desabilita signup | Supabase Auth, cookies SSR | `/auth/callback` não troca código por sessão; credenciais demo ficam pré-preenchidas no bundle |
| Proteção de páginas e renovação de sessão | IMPLEMENTADO MAS INCOMPLETO | `src/middleware.ts:5-46` e `src/lib/supabase/middleware.ts:5-33` | Variáveis públicas Supabase | Só protege quando env está configurado; `middleware` está depreciado no Next 16; não há guard reativo no client |
| RBAC e RLS | IMPLEMENTADO COM RISCO/BUG | `supabase/migrations/20250901000003_rls_policies.sql:37-45`, `57-108`; `20250901000005...sql:15-49` | `profiles`, `store_members`, funções `SECURITY DEFINER` | `profiles_update_own` permite alterar papel/organização; policies de categoria têm `WITH CHECK` insuficiente; papel do cliente é editável |
| Isolamento entre organizações/lojas | IMPLEMENTADO COM RISCO/BUG | `current_user_org_id`, `user_has_store_access` em `20250901000002...sql:187-225`; vários IDs fixos em `pdv-screen.tsx:23-26` | RLS, membership e contexto local | Relações não têm FK composta org+entidade; localStorage/IndexedDB não são namespaced por usuário/org |
| Catálogo de produtos ativos | IMPLEMENTADO MAS INCOMPLETO | `src/hooks/use-products.ts:27-46`, `src/lib/domain/product.ts:8-21` | Supabase `products`, RLS | Sem cache local; falha offline após reload deixa catálogo vazio; fixtures são selecionáveis por env público |
| Busca por nome/SKU/barcode | IMPLEMENTADO E FUNCIONANDO | `src/lib/domain/product.ts:12-23`, `src/components/pdv/product-search.tsx:28-58` | Catálogo carregado | Não há teste E2E verde no estado atual por causa do redirect de autenticação |
| Scanner HID | IMPLEMENTADO E FUNCIONANDO | `src/lib/domain/hid-scanner.ts:7-41`, `src/hooks/use-hid-scanner.ts:16-35`; testes em `tests/unit/sprint3-sale-ops.test.ts:122-139` | Catálogo, foco/modal | Código depende de limiar fixo de 45 ms e conjunto restrito de caracteres |
| Carrinho e quantidades | IMPLEMENTADO E FUNCIONANDO | `addItem`, `setQuantity`, `removeItem` em `src/lib/domain/sale-ops.ts:104-174`; testes unitários | Zustand, estoque local | A implementação de domínio é boa, mas o carrinho persistido não é isolado por loja/sessão |
| Contexto de carrinho por loja | IMPLEMENTADO COM RISCO/BUG | `src/components/pdv/pdv-screen.tsx:107-120` muda apenas `storeId`; `src/stores/cart-store.ts:30-65` preserva linhas | Zustand persistido, estoque por loja | Trocar loja com carrinho aberto pode vender as linhas no novo estoque; logout não limpa carrinho |
| Descontos por papel | IMPLEMENTADO COM RISCO/BUG | `src/lib/domain/sale-ops.ts:28-49,176-192`; wrapper SQL em `20250901000006...sql:59-89`; API retorna 403 em `route.ts:40-64` | Papel UI, membership, RPC | Caixa pode escolher gerente no client e fechar venda local com desconto que só falhará no sync |
| Fechamento local cash | IMPLEMENTADO MAS INCOMPLETO | `src/lib/offline/close-sale.ts:17-141`; transação única e teste em `sprint2-local-first.test.tsx:83-117` | Dexie, saldo local, outbox | Não há bootstrap confiável de estoque/catálogo; não modela recebido/troco |
| Pagamento cash | IMPLEMENTADO MAS INCOMPLETO | `CashPaymentAdapter` em `src/lib/adapters/payment.ts:13-20`; pagamentos locais em `close-sale.ts:98-105` | Adapter, `payments`, RPC | Apenas registra o total; não existe gaveta, sessão de caixa, troco ou conciliação |
| Cartão/Pix/voucher/other | IMPLEMENTADO MAS INCOMPLETO | `NotConfiguredPaymentAdapter` em `src/lib/adapters/payment.ts:22-36`; UI em `sale-summary.tsx:22-30` | Adapters futuros | O comportamento de rascunho está definido, mas não há captura real |
| NFC-e/SAT | DOCUMENTADO MAS NÃO IMPLEMENTADO | `src/lib/adapters/fiscal.ts:1-20`; `process_sale` insere `not_configured` em `20250901000004...sql:271-272` | Adapter fiscal e serviço externo | Nenhuma emissão, assinatura, contingência ou cancelamento |
| Persistência IndexedDB | IMPLEMENTADO E FUNCIONANDO | Schema `pdv_local_v1` em `src/lib/offline/pdv-local-db.ts:23-43`; quota tratada em `quota.ts` | IndexedDB/Dexie | Não há versionamento de migrações além da versão 1 nem escopo por usuário |
| Outbox e `clientMutationId` | IMPLEMENTADO COM RISCO/BUG | `src/lib/offline/outbox.ts:17-21,72-97,189-216`; idempotência SQL em `20250901000002...sql:173-179` | Dexie, RPC | Comando não carrega identidade do operador; concorrência e crash podem produzir reenvio/conflito ou duplicidade comercial com novo UUID |
| Retry/backoff | IMPLEMENTADO COM RISCO/BUG | `src/lib/offline/backoff.ts:1-21`, `scheduleOutboxRetry` em `outbox.ts:100-121` | Timer/provider | Ao chegar em `failed`, a venda continua `pending_sync` e continua reservando estoque local |
| Push de vendas | IMPLEMENTADO COM RISCO/BUG | `pushPendingCommands`/`pushOutboxCommand` em `src/lib/offline/sync-engine.ts:140-180` | `fetch`, API, lock | Conflitos são visíveis, mas falha terminal não tem restauração/reprocessamento de UI |
| Pull e reconciliação | IMPLEMENTADO COM RISCO/BUG | `pullChanges` e `applyPulledChanges` em `sync-engine.ts:182-319`; API em `src/app/api/sync/changes/route.ts:30-60` | RLS, timestamp, IndexedDB | `lastPullAt` é único para todas as lojas; há janela/race de reservas; lista de vendas limita 200; não há validação da resposta nem cursor completo |
| Background Sync/service worker | DOCUMENTADO MAS NÃO IMPLEMENTADO | Worker em `src/workers/sync-worker.ts:5-25`; nenhum `register` no código | Service Worker, browser Sync API | O arquivo existe, mas nunca é instalado/registrado |
| Estoque auditado | IMPLEMENTADO COM RISCO/BUG | `adjust_inventory` em `20250901000005...sql:125-241`; `process_sale` grava movimento em `20250901000004...sql:222-248` | Locks, constraints, audit log | Integridade org/store não é composta; audit log pode ser forjado diretamente |
| Inventário UI | IMPLEMENTADO COM RISCO/BUG | `src/components/inventory/inventory-screen.tsx:109-282`, fallback em `src/lib/server/inventory-query.ts:54-70` | SSR RPC, role UX | Em exceção do Supabase, SSR exibe estoque/produtos demo; após ajuste/importação a tabela não recarrega; papel e loja são seletores de demonstração |
| CSV de inventário | IMPLEMENTADO COM RISCO/BUG | Parser em `src/lib/domain/inventory.ts:43-109`; import linha a linha em `src/app/api/inventory/import/route.ts:33-74` | RPC `adjust_inventory` | Exportação chama limite 100 e não pagina; precisão de delta não restringe três casas; parcialidade não é explicitada como transação |
| CRUD de produto | IMPLEMENTADO COM RISCO/BUG | Rotas `src/app/api/products/route.ts:7-48` e `[id]/route.ts:10-62` | Zod, RLS | Converte BRL string para `Number` antes do banco; autorização depende de `default_role` mutável |
| Dashboard SSR | IMPLEMENTADO COM RISCO/BUG | `src/app/dashboard/page.tsx:5-29`, `dashboard-query.ts:38-85`, RPC SQL `20250901000005...sql:243-363` | Analytics view, RLS, data | COGS usa custo atual e receita ignora desconto global; filtros/paginação e estado degradado não têm teste de integração |
| Relatórios e métricas | IMPLEMENTADO MAS INCOMPLETO | `get_dashboard_metrics` e `src/app/api/dashboard/metrics/route.ts:7-44` | `analytics.product_period_metrics` | Não há exportação/fechamento de caixa; caixa é bloqueado só por autorização real no backend |
| Caixa/gaveta/turno | AUSENTE | Não existem tabelas, RPCs ou rotas de sessão/movimento de caixa; `docs/assumptions.md:17-21` registra que não foi modelado | — | Não é possível auditar abertura, sangria, fechamento ou divergência |
| Estorno/refund | DOCUMENTADO MAS NÃO IMPLEMENTADO | Enums existem em `20250901000001...sql:5-12,14-20,39-44`; docs em `AGENTS.md:60-66` | Novo fluxo de refund | Não há UI, API, RPC de estorno nem movimentos reversos |
| Recibo HTML | IMPLEMENTADO E FUNCIONANDO | `renderReceiptHtml` com escaping em `src/lib/domain/receipt.ts:25-94`; dialog em `receipt-dialog.tsx:9-29` | Venda local, timezone | Status do pagamento no recibo é fixado em `captured`, embora IndexedDB grave `pending` até sync |
| Tipos DB e geração | IMPLEMENTADO MAS INCOMPLETO | `scripts/generate-db-types.mjs:14-51`, `src/lib/db/types.ts:12-592` | Supabase CLI ou snapshot | Snapshot pode divergir do banco; `numeric` é representado como `number`, incompatível com a regra monetária estrita |
| Testes automatizados | IMPLEMENTADO MAS INCOMPLETO | 5 arquivos unitários; 3 specs E2E | Vitest, Playwright, Supabase local | Não há testes de RLS/RPC real, concorrência Postgres, rotas autenticadas ou isolamento de tenant |

## 4. Análise Técnica Detalhada

### 4.1 Rastreamento do fluxo transacional

#### Produto

1. `useProducts` consulta `products` diretamente pelo client Supabase, selecionando campos de catálogo (`src/hooks/use-products.ts:27-35`).
2. A resposta é filtrada para produtos ativos por `filterActiveProducts` (`src/lib/domain/product.ts:8-10`).
3. Se a consulta falha, apenas o modo explícito `NEXT_PUBLIC_PDV_FIXTURES=1` usa `DEMO_PRODUCTS` (`src/lib/domain/catalog-load.ts:3-16`, `src/lib/pdv/fixtures.ts:5-10`). Sem fixtures, o catálogo fica vazio e apresenta erro.
4. Clientes seguem caminho diferente: `useCustomers` inicia e repõe sempre `DEMO_CUSTOMERS` quando não consegue consultar Supabase (`src/hooks/use-customers.ts:7-30`). Isso pode exibir IDs e pessoas demo fora do contexto real.
5. A página SSR de inventário tem fallback incondicional para `DEMO_PRODUCTS` e `demoStockForStore` em qualquer exceção (`src/lib/server/inventory-query.ts:54-70`), sem exigir `NEXT_PUBLIC_PDV_FIXTURES=1`. Em indisponibilidade real, a tela pode parecer preenchida com dados que não pertencem ao tenant.

#### Carrinho

1. `ProductSearch` aplica debounce de 300 ms e resolve Enter como SKU/barcode ou primeiro resultado (`src/components/pdv/product-search.tsx:28-51`).
2. `usePdvSale.addProduct` chama `addItem` com o estoque projetado (`src/hooks/use-pdv-sale.ts:66-78`).
3. `addItem` rejeita produto inativo, quantidade não positiva, estoque vazio e quantidade acima do saldo (`src/lib/domain/sale-ops.ts:104-142`).
4. Quantidade, remoção, cliente e desconto são mantidos em Zustand. O carrinho usa persistência em `localStorage` com chave fixa `nex-pdv-cart` (`src/stores/cart-store.ts:9,68-88`).
5. O seletor de loja altera apenas o `storeId`, sem limpar ou revalidar as linhas existentes (`src/components/pdv/pdv-screen.tsx:107-120`). Essa é uma quebra de contexto transacional.

#### Checkout e pagamento

1. `useCheckout.paySale` lê `inventoryBalances` da loja corrente (`src/hooks/use-checkout.ts:80-90`).
2. `validateSale` recalcula estoque, produto ativo, descontos de item, desconto de cabeçalho e total (`use-checkout.ts:93-105`, `sale-ops.ts:205-245`).
3. O adapter cash retorna `configured`; adapters eletrônicos retornam `not_configured` e deixam o carrinho intacto (`payment.ts:13-36`, `payment-attempt.ts:12-19`).
4. Para cash, `closeSale` abre uma transação `rw` sobre vendas, itens, pagamentos, saldo e outbox (`close-sale.ts:21-28`).
5. O fechamento local calcula subtotal/total, baixa o estoque projetado, grava venda `pending_sync`, itens, pagamento `pending` e comando outbox (`close-sale.ts:47-133`).
6. A UI limpa o carrinho depois que a transação local termina, não antes (`use-checkout.ts:117-130`), o que preserva a venda diante de falhas de rede. Falhas de quota são convertidas em `IndexedDbQuotaError` e sinalizadas (`close-sale.ts:142-144`, `use-checkout.ts:168-173`).

#### Venda, caixa, estoque e Postgres

1. O outbox envia o mesmo payload para `POST /api/sales/process` (`sync-engine.ts:150-180`).
2. A API autentica, valida Zod, resolve o papel de membership para o desconto e chama `supabase.rpc("process_sale")` (`src/app/api/sales/process/route.ts:7-67`).
3. A migration `20250901000006_sale_discount_cap.sql` renomeia o primeiro RPC para `process_sale_core` e cria um wrapper que valida o limite antes do core (`:53-89`).
4. O core verifica sessão, loja ativa/membership, produto ativo, preço do catálogo, totais, pagamento cash, cliente, locks `FOR UPDATE` e estoque suficiente (`20250901000004_process_sale_rpc.sql:30-157`).
5. O core grava, na mesma execução PL/pgSQL, `sales`, `sale_idempotency_keys`, `sale_items`, baixa em `inventory_balances`, `inventory_movements`, `payments`, `fiscal_documents` e `audit_logs` (`:159-302`).
6. A venda confirmada usa `status=confirmed` e `sync_status=synced`; a resposta contém `sale_id`, `replay`, `status` e `total` na primeira execução.
7. Não existe a etapa de caixa físico. O pagamento é apenas um registro lógico e não há `cash_sessions`, `cash_movements`, recebido, troco ou fechamento.

#### Persistência e sincronização

1. O `clientMutationId` é a chave primária do outbox e é verificado antes do envio (`outbox.ts:17-21`, `sync-engine.ts:150-153`).
2. `claimOutboxProcessing` faz uma reivindicação compare-and-set dentro de transação Dexie (`outbox.ts:72-97`).
3. Respostas são aplicadas somente se o registro ainda estiver `processing` com o mesmo `updatedAt` (`sync-engine.ts:223-255`).
4. 2xx reconcilia venda/pagamento; 401 libera o comando para futura sessão; 408/429/5xx fazem retry; 403/409/422 criam conflito; demais erros viram `failed` (`http-classify.ts:3-15`, `sync-engine.ts:256-281`).
5. Conflito restaura estoque projetado e o banner o torna visível (`sync-engine.ts:84-128`, `conflict-banner.tsx:3-21`).
6. O recibo consulta o outbox da própria venda e evita afirmar `synced` com base apenas no contador global (`use-checkout.ts:143-167`, `receipt-sync.ts:15-32`).

### 4.2 Segurança: autenticação, RBAC, RLS e secrets

#### Controles corretos

- O client usa apenas `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`src/lib/supabase/client.ts:4-12`).
- O service role só aparece no script server-side de seed (`scripts/seed-auth.ts:36-45`), não no client.
- As páginas protegidas e as APIs verificam sessão; as RPCs também verificam `auth.uid()` (`src/middleware.ts:24-46`, rotas API, `20250901000004...sql:30-41`).
- O acesso à loja usa membership e loja ativa (`20250901000002...sql:197-212`).
- Não há policies de `UPDATE`/`DELETE` para vendas, itens ou pagamentos; estoque direto também não tem policy de escrita (`20250901000003...sql:110-156`).
- A auditoria de movimentos é gerada dentro das RPCs de venda/ajuste e inclui papel, motivo e saldo posterior (`20250901000005...sql:207-239`).

#### Falhas críticas

1. **Autoelevação via perfil**

   `profiles_update_own` autoriza `UPDATE` quando `id = auth.uid()` e só exige o mesmo `id` no `WITH CHECK`; não restringe colunas (`20250901000003_rls_policies.sql:37-45`). Como `default_role` e `org_id` são alteráveis, o usuário pode tentar promover a própria função e trocar a organização.

   A consequência é direta:

   - policies de produto usam `profiles.default_role` (`20250901000003...sql:73-108` e `20250901000005...sql:52-87`);
   - `user_can_manage_inventory` aceita `profiles.default_role` admin/manager como alternativa ao papel da loja (`20250901000005...sql:15-33`);
   - `current_user_org_id()` retorna o `org_id` do perfil (`20250901000002...sql:187-195`).

   Isso transforma um campo autoeditável em fonte de autorização e pode permitir leitura/alteração de dados de outra organização. É a falha prioritária.

2. **`cost_price` não está realmente protegido por RLS**

   `products_select_active` filtra linhas, mas não colunas (`20250901000003...sql:68-71`). O grant global concede `SELECT` em todas as tabelas para `authenticated` (`:23-25`). A UI evita selecionar `cost_price`, mas um caixa pode usar o client Supabase diretamente para requisitar a coluna. O RPC de inventário omite o custo para caixa (`20250901000005...sql:393-425`), mas isso não corrige o acesso direto à tabela.

3. **Audit log pode ser forjado**

   `audit_logs_insert` permite a qualquer usuário autenticado inserir qualquer `action`, `entity_id`, `store_id` e `payload`, desde que o `org_id` seja o da sessão (`20250901000003...sql:166-181`). A tabela é append-only, mas não é confiável como trilha de auditoria se o caixa consegue inserir eventos falsos. O ideal é revogar insert direto e deixar apenas RPCs server-side inserirem eventos.

4. **Policy de categoria permite insert indevido**

   `categories_admin_write` e `categories_manager_write` são `FOR ALL`, mas seus `WITH CHECK` validam apenas `org_id` (`20250901000003...sql:57-66`, `20250901000005...sql:89-98`). Em `INSERT`, a expressão `USING` não autoriza a operação; portanto, qualquer autenticado da organização que satisfaça o `WITH CHECK` pode inserir categoria, inclusive caixa.

5. **Relações de organização não são compostas**

   `store_members` armazena `org_id` e `store_id`, mas só referencia `stores(id)`; `inventory_balances`, `sales`, `payments` e movimentos também não têm constraints que exijam a correspondência org+store+product (`20250901000002...sql:34-42,70-78,91-146`). As RPCs corrigem isso por lógica, mas a integridade não está garantida contra dados inseridos por serviço privilegiado ou migrações futuras.

6. **Dados locais não têm identidade**

   `CART_PERSIST_KEY` é global (`src/stores/cart-store.ts:9`), o banco Dexie também tem nome global (`src/lib/offline/types.ts:4`) e `endClientSession` apenas limpa stores de sessão em memória e chama signout (`src/lib/offline/end-session.ts:4-13`). Carrinho, outbox, clientes e estoques locais não são separados por usuário/org. Uma venda criada por A pode ser enviada por B, sendo gravada no Postgres com o `auth.uid()` de B (`20250901000004...sql:10,159-184`).

7. **RLS não força isolamento para owner/service role**

   As migrations usam `ENABLE ROW LEVEL SECURITY`, mas não `FORCE ROW LEVEL SECURITY` (`20250901000003_rls_policies.sql:3-17`). Isso é compatível com funções `SECURITY DEFINER` e operações administrativas, mas significa que owner/service role continuam podendo bypassar RLS; esse caminho precisa ser controlado operacionalmente.

### 4.3 Consistência offline-first

#### Invariantes preservadas

- `closeSale` grava venda, itens, pagamentos, baixa projetada e outbox na mesma transação.
- Reexecução do mesmo `clientMutationId` retorna a venda local existente sem nova baixa (`close-sale.ts:29-45`).
- Retry atualiza a chave existente; a função rejeita mudança do ID (`outbox.ts:17-21,189-216`).
- Lock multi-tab é separado do heartbeat (`multi-tab-lock.ts`, `heartbeat.ts`), e o caminho principal usa `navigator.locks` quando disponível.
- Conflitos 403/409/422 permanecem visíveis e restauram o saldo projetado.
- Quota local não deixa outbox órfã, conforme teste `sprint2-local-first.test.tsx:325-335`.

#### Quebras identificadas

1. **Primeiro carregamento de estoque não fecha o ciclo**

   `SyncProvider` chama `refreshSyncUi` no mount, mas só chama `flushPending` no evento `online`, no timer de 10 segundos ou na mensagem do worker (`src/components/providers/sync-provider.tsx:13-53`). `runSyncCycle` até executa `pullChanges`, mas `applyPulledChanges` grava IndexedDB sem incrementar `inventoryEpoch` (`sync-engine.ts:284-306`). `useProjectedStock` só relê o banco quando `storeId` ou `epoch` muda (`src/hooks/use-projected-stock.ts:7-39`). Assim, uma instalação com banco local vazio pode receber estoque no IndexedDB e continuar com `balances={}`, mantendo checkout desabilitado (`pdv-screen.tsx:80-86`) até uma remontagem/troca de loja.

2. **Não existe catálogo local**

   Produtos e clientes são consultados diretamente no Supabase. `ensureLocalInventory` foi transformado em no-op (`src/lib/offline/seed-local-inventory.ts:3-8`), corretamente evitando inventário fictício, mas não foi criado um mecanismo equivalente para catalogar produtos/clientes. Sem rede e após reload, o usuário não consegue montar uma nova venda.

3. **Cursor de sync global**

   `pullChanges` lê e grava sempre `meta["lastPullAt"]` (`sync-engine.ts:185-205,305`). O valor não inclui `storeId`, `orgId` ou usuário. Depois de sincronizar a loja A, a loja B usa o timestamp de A e pode não receber linhas antigas de B. O mesmo problema aparece ao alternar usuários no mesmo navegador.

4. **Janela de pull não é segura para volume/convergência**

   A API limita vendas a 200 (`src/app/api/sync/changes/route.ts:35-40`) e o cliente avança `lastPullAt` com base em `serverTime` (`:56-59`), sem cursor de vendas. Mais de 200 alterações podem ser descartadas da resposta e consideradas consumidas. Não há schema Zod para validar a resposta recebida antes de gravá-la em IndexedDB.

5. **Reserva não é liberada em falha terminal**

   `scheduleOutboxRetry` muda o outbox para `failed` na décima falha (`outbox.ts:106-120`), mas não muda a venda. `pendingReservations` continua contando qualquer venda cujo `sale.syncStatus` seja `pending`/`processing` (`sync-engine.ts:321-331`). Como `LocalSale.syncStatus` permanece `pending`, o estoque projetado continua reservado indefinidamente para um comando que não será reenviado.

6. **Falha terminal não tem UX de recuperação**

   O banner existe apenas para conflitos. O estado `failed` é contado como não sincronizado, mas `SyncStatusBadge` não recebe a opção `failed` e tende a exibi-lo como `pending` (`src/components/pdv/sync-status-badge.tsx:19-40`, `src/stores/sync-store.ts:49-60`). Não há botão para retry, descarte controlado, resolução ou exportação da venda falha.

7. **Worker não está integrado**

   `src/workers/sync-worker.ts` apenas notifica janelas quando recebe a tag `nex-pending-sales`; não executa o outbox. Como não há registro, o Background Sync documentado é inexistente na prática.

8. **Lock fallback não é atômico**

   O fallback em `localStorage` faz `getItem`, depois `setItem`, sem operação compare-and-set (`src/lib/offline/multi-tab-lock.ts:28-48`). O servidor possui idempotência, reduzindo duplicidade confirmada, mas duas abas podem iniciar trabalho concorrente em browsers sem Web Locks.

9. **Race entre checkout local e pull**

   `pendingReservations` calcula as reservas antes de `applyPulledChanges` abrir a transação que grava o saldo (`src/lib/offline/sync-engine.ts:289-306,321-331`). Uma venda fechada entre essas duas etapas pode não ser descontada do saldo recém-puxado, deixando o estoque projetado artificialmente alto.

10. **Restauração de conflito não recalcula reservas restantes**

   `restoreProjectedInventory` soma somente os itens da venda conflitante (`src/lib/offline/sync-engine.ts:334-349`). Com várias vendas pendentes do mesmo produto, a restauração deveria recalcular `max(0, serverQuantity - reservas_restantes)`; a soma simples pode superestimar estoque e liberar venda local excessiva.

11. **Lease de processamento pode expirar durante request**

   `resetStuckProcessing` libera `processing` após 30 segundos (`src/lib/offline/outbox.ts:41-57`), mas o push não usa `AbortController` nem timeout (`src/lib/offline/sync-engine.ts:162-179`). Uma requisição lenta pode continuar em voo enquanto outro ciclo reenvia o mesmo comando. A constraint reduz duplicidade final, mas o segundo request pode virar conflito falso.

12. **Concorrência de idempotência server-side não retorna replay garantido**

   O core consulta `sales` antes do insert (`20250901000004_process_sale_rpc.sql:48-59`) e só depois cria a chave de idempotência (`:187-188`). Duas chamadas simultâneas podem passar pela consulta vazia; uma confirma e a outra recebe erro de unique/estoque, em vez de receber o mesmo replay.

13. **Crash entre fechamento local e limpeza do carrinho**

   `closeSale` confirma a transação antes de `cart.clear()` (`src/hooks/use-checkout.ts:117-141`). Se a aba cair nesse intervalo, uma nova tentativa gera outro UUID (`:115`) e pode criar uma segunda venda comercialmente idêntica; a idempotência protege somente reuso do mesmo UUID.

14. **Validação da fronteira local é menor que a validação da UI**

   `closeSale` verifica secrets e cash (`src/lib/offline/close-sale.ts:8-15`), mas não valida lista/quantidade/descontos/pagamento-total. A API/RPC corrige parte disso após o sync, mas o recibo e o estoque projetado já podem representar entrada inválida localmente.

### 4.4 Integridade do banco e transações

#### Pontos fortes

- Valores comerciais do schema usam `numeric(12,2)` e quantidades `numeric(12,3)` (`20250901000002...sql:54-78,91-132`).
- Há `CHECK` para preço/custo/total não negativo e estoque não negativo.
- `process_sale` recalcula subtotal, total e pagamentos no servidor; não confia no total do client (`20250901000004...sql:71-124`).
- Há lock pessimista `FOR UPDATE` antes da validação/baixa (`:133-157,222-227`).
- Venda, pagamento, movimento de estoque, fiscal e audit log são escritos na mesma execução transacional da RPC.
- `adjust_inventory` exige motivo, restringe `movement_type`, trava o saldo e impede resultado negativo (`20250901000005...sql:148-205`).
- Idempotência é sustentada por `UNIQUE (store_id, client_mutation_id)` em `sales` e chave primária equivalente em `sale_idempotency_keys` (`20250901000002...sql:91-108,173-179`).

#### Pontos de atenção

1. **COGS não é histórico**

   `analytics.product_period_metrics` calcula `sum(round(si.quantity * p.cost_price, 2))` (`20250901000005...sql:105-123`). Como `sale_items` não guarda `unit_cost`, uma alteração posterior em `products.cost_price` muda a margem histórica. O dashboard é tecnicamente executável, mas pode produzir relatórios financeiros incorretos.

2. **Receita do dashboard ignora desconto global**

   A view agrega `sum(si.total)` por item (`20250901000005...sql:114-116`), enquanto `sales.discount` é aplicado somente ao total da venda no core (`20250901000004...sql:103-108`). Como o dashboard não aloca nem subtrai o desconto de cabeçalho, vendas com desconto global podem aparecer com receita/lucro maiores que o valor efetivamente pago.

3. **Seed inicial não cria movimentos de estoque**

   `supabase/seed.sql:44-64` insere saldos diretamente em `inventory_balances`, mas não cria `inventory_movements` correspondentes. Isso deve ser explicitado como saldo inicial ou gerar movimento de abertura para manter reconciliação auditável.

4. **Timestamps não são mantidos por trigger**

   O schema define `updated_at` com default (`20250901000002...sql:3-10,54-67`), mas não há `CREATE TRIGGER` no repositório. A RPC de estoque atualiza manualmente o timestamp; alterações de produto/perfil podem preservar um `updated_at` antigo, comprometendo sincronização e auditoria temporal.

5. **`sale_id` local não é preservado pelo core**

   O payload aceita `sale_id` (`src/lib/validation/schemas.ts:21-33`) e `closeSale` o envia (`src/lib/offline/close-sale.ts:108-114`), mas `process_sale_core` sempre gera `v_sale_id` novo (`20250901000004...sql:14-16,159-185`). O fluxo funciona usando `serverSaleId`, porém o contrato de identidade local/servidor está incompleto e merece decisão explícita.

6. **Múltiplos descontos e precisão de quantidade**

   A API aceita quantidade `z.number().positive()` sem restringir escala ou máximo (`src/lib/validation/schemas.ts:5-14`). O Postgres converte para `numeric(12,3)`, podendo arredondar uma entrada como `1.2345`, enquanto o cálculo local usa o valor original. O mesmo padrão aparece no CSV (`inventory.ts:90-106`), que converte para `number` sem exigir três casas.

7. **Conversão monetária para `Number`**

   As rotas de produto validam strings monetárias, mas convertem para `Number` antes do insert/update (`src/app/api/products/route.ts:31-39`, `[id]/route.ts:31-39`). Isso contradiz a regra de não usar float para dinheiro e pode perder precisão em valores próximos ao limite de `numeric(12,2)`.

8. **Importação CSV não é uma transação de arquivo**

   Cada linha chama `adjust_inventory` separadamente (`src/app/api/inventory/import/route.ts:38-67`). A resposta permite sucessos parciais, o que pode ser uma decisão de produto, mas não há modo all-or-nothing, pré-validação de saldo total ou idempotency key do arquivo. Uma repetição do mesmo CSV aplica os movimentos novamente.

9. **Exportação truncada**

   `GET /api/inventory/export` chama `get_inventory_page` com `limit: 100` e ignora o limite/cursor recebido (`src/app/api/inventory/export/route.ts:14-31`). A exportação não representa necessariamente todo o inventário.

10. **Arquivo live incompatível**

   `supabase/process_sale_live.sql:5-9` descreve tabelas com `products.store_id/price/stock`, `sales.payment_method` e `sale_items.unit_cost/total_price`, enquanto o schema atual usa `org_id`, `unit_price`, `inventory_balances` e outros nomes. O arquivo também cria `process_sale` como `SECURITY INVOKER` (`:14-18`) e grava apenas tabelas do schema antigo (`:116-191`). Se executado contra o banco atual, pode substituir a RPC segura e depois falhar por colunas inexistentes. Ele não deve ser tratado como migração nem runbook válido do estado atual.

11. **Snapshot de tipos não é prova de schema aplicado**

   `scripts/generate-db-types.mjs` tenta o Supabase local e, em qualquer falha, escreve o snapshot (`:14-51`). Isso é útil para CI sem Docker, mas permite que migrations quebradas ou não aplicadas convivam com tipos aparentemente válidos. Além disso, o gerador representa `numeric` como `number` em `src/lib/db/types.ts:150-175,252-285,288-330`, o que enfraquece a regra de dinheiro por string.

### 4.5 Cobertura e evidência de testes

Verificações executadas durante a auditoria:

| Comando | Resultado observado |
|---|---|
| `pnpm test` | **PASS** — 5 arquivos, 54 testes |
| `pnpm typecheck` | **PASS** |
| `pnpm lint` | **Exit 0**, 3 warnings: `window.location.href` em `inventory-screen.tsx:124` e dois parâmetros não usados no teste E2E |
| `pnpm build` | **PASS** — rotas listadas na seção 2.4; warning de `middleware` depreciado |
| `pnpm test:e2e` | **FAIL** — 9 testes: 2 passaram e 7 falharam |

As sete falhas E2E ocorreram antes da funcionalidade: `pdv-sale.spec.ts` não encontrou `store-select` porque a página estava em “Entrar no PDV”; os testes de inventário/dashboard não encontraram os headings protegidos. O snapshot de erro mostra o formulário de login (`test-results/**/error-context.md`). A configuração define `NEXT_PUBLIC_PDV_FIXTURES=1`, mas não cria sessão autenticada nem `storageState` (`playwright.config.ts:13-20`).

Há boa cobertura unitária de:

- arredondamento e somas monetárias;
- regras de carrinho, desconto, estoque local e scanner;
- transação Dexie, quota, idempotência, retry, conflito e reconciliação;
- parser CSV, métricas de dashboard e `PermissionGate`.

Não há cobertura automatizada confiável para:

- RLS real e policies com usuários distintos;
- RPCs Postgres sob concorrência;
- rollback transacional real de `process_sale`/`adjust_inventory`;
- autorização das rotas API com sessão real;
- isolamento cross-tenant;
- primeiro pull de estoque refletindo na UI;
- logout com outbox pendente;
- falha terminal liberando reserva;
- COGS após alteração histórica de custo;
- importação/exportação completa acima de 100 linhas;
- registro e execução do service worker.

Os números em `docs/agent-log.md:70-77` (41 testes unitários e 9 E2E verdes) representam uma execução anterior e não correspondem à verificação atual de 54 unitários e 7 falhas E2E.

## 5. Diagnóstico de Problemas

### CRÍTICO

**C1 — Escalação de privilégio e possível quebra de isolamento de tenant.**  
`profiles_update_own` permite autoalterar `default_role`/`org_id`; esses campos alimentam policies e helpers de autorização. Evidências: `20250901000003_rls_policies.sql:37-45`, `20250901000002_core_schema.sql:187-225`, `20250901000005_sprint4_inventory_dashboard_rbac.sql:15-33,52-87`.

**C2 — Sobrescrita operacional da RPC de venda.**  
`supabase/process_sale_live.sql` tem assinatura igual à RPC canônica, usa `SECURITY INVOKER` e um schema incompatível. Um operador que o execute pode remover, na prática, as garantias de membership, lock e baixa de estoque do fluxo oficial. Evidências: `supabase/process_sale_live.sql:1-18,116-206`, comparado com `supabase/migrations/20250901000004_process_sale_rpc.sql:1-307`.

### ALTO

**A1 — Custo acessível por caixa via tabela `products`.**  
Grant global + RLS apenas por linha não oculta `cost_price`. Evidências: `20250901000003_rls_policies.sql:23-25,68-71`; coluna em `20250901000002_core_schema.sql:54-67`.

**A2 — Venda offline pode ser atribuída a outro operador.**  
Outbox/DB local não têm user/org; Postgres atribui `cashier_id` ao usuário que fizer o push. Evidências: `src/lib/offline/types.ts:56-68`, `src/lib/offline/end-session.ts:4-13`, `20250901000004_process_sale_rpc.sql:159-184`.

**A3 — PDV pode permanecer sem estoque após o pull inicial.**  
O pull grava Dexie, mas não dispara reload de `useProjectedStock`; checkout depende de `balances` não vazio. Evidências: `src/components/providers/sync-provider.tsx:13-37`, `src/lib/offline/sync-engine.ts:284-306`, `src/hooks/use-projected-stock.ts:7-39`, `src/components/pdv/pdv-screen.tsx:80-86`.

**A4 — Sync por loja incorreto.**  
`meta.lastPullAt` é global, mas o banco possui estoque por loja. Evidência: `src/lib/offline/sync-engine.ts:182-205,305`; schema de estoque em `src/lib/offline/pdv-local-db.ts:34-42`.

**A5 — Reserva de estoque presa após `failed`.**  
Outbox chega a `failed`, mas `LocalSale.syncStatus` permanece `pending`, e `pendingReservations` continua abatendo a venda. Evidência: `src/lib/offline/outbox.ts:100-121`, `src/lib/offline/sync-engine.ts:321-331`.

**A6 — COGS histórico incorreto.**  
O relatório calcula custo usando `products.cost_price` atual, não snapshot de custo. Evidência: `supabase/migrations/20250901000005_sprint4_inventory_dashboard_rbac.sql:105-123`.

**A7 — Catálogo/inventário/cliente demo em indisponibilidade real.**  
Clientes sempre retornam `DEMO_CUSTOMERS` em falha; o SSR de inventário retorna `DEMO_PRODUCTS`/saldo demo em qualquer exceção; fixtures públicas podem inserir saldo demo local. Evidências: `src/hooks/use-customers.ts:7-30`, `src/lib/server/inventory-query.ts:54-70`, `src/lib/pdv/fixtures.ts:5-35`.

**A8 — E2E protegido não tem autenticação.**  
A suíte atual falha com redirect para login; portanto as jornadas críticas não estão verificadas no ambiente atual. Evidências: `playwright.config.ts:13-20`, `tests/e2e/pdv-sale.spec.ts:27-94`, snapshots em `test-results/**/error-context.md`.

**A9 — Audit log direto pode fabricar evidência.**  
Qualquer autenticado pode inserir payload/action arbitrários em `audit_logs`. Evidência: `20250901000003_rls_policies.sql:166-181`.

**A10 — Caixa pode inserir categoria diretamente.**  
As policies `FOR ALL` de categorias possuem `WITH CHECK` apenas por organização; como `USING` não autoriza `INSERT`, o caixa autenticado pode inserir categoria. Evidências: `20250901000003_rls_policies.sql:57-66`, `20250901000005_sprint4_inventory_dashboard_rbac.sql:89-98`.

**A11 — Receita e lucro podem ser superestimados com desconto global.**  
A view soma `sale_items.total`, mas `sales.discount` só é aplicado no total da venda e não é alocado no dashboard. Evidências: `20250901000004_process_sale_rpc.sql:103-108`, `20250901000005_sprint4_inventory_dashboard_rbac.sql:105-123`.

### MÉDIO

**M1 — Troca de loja não isola o carrinho.**  
`setStoreId` não limpa linhas persistidas; venda pode ser fechada contra estoque da loja nova. Evidências: `src/components/pdv/pdv-screen.tsx:107-120`, `src/stores/cart-store.ts:30-65`.

**M2 — Sem caixa físico.**  
Não há sessão, abertura, sangria, fechamento, troco ou conciliação. Evidência: ausência de tabelas/rotas e `docs/assumptions.md:17-21`.

**M3 — Falhas de sync não têm resolução operacional.**  
Conflitos apenas aparecem em banner; failed não tem fluxo de retry/manual recovery. Evidências: `src/components/pdv/conflict-banner.tsx:3-21`, `src/components/pdv/sync-status-badge.tsx:25-40`.

**M4 — Pull não pagina vendas nem valida resposta.**  
Limite 200 e cast direto para `PullChangesResponse`. Evidências: `src/app/api/sync/changes/route.ts:35-45`, `src/lib/offline/sync-engine.ts:204-205`.

**M5 — CSV/exportação têm limites e formato incompletos.**  
Exporta no máximo 100; parser não garante escala de quantidade; campos CSV além de `name` não são completamente protegidos contra delimitadores. Evidências: `src/app/api/inventory/export/route.ts:24-55`, `src/lib/domain/inventory.ts:90-119`.

**M6 — Dinheiro sai do domínio decimal na API de produto.**  
`Number(parsed.data.unit_price)` e `Number(parsed.data.cost_price)` contradizem o contrato monetário. Evidências: `src/app/api/products/route.ts:31-39`, `src/app/api/products/[id]/route.ts:31-39`.

**M7 — UI de inventário não atualiza a tabela após mutação.**  
Ajuste/importação só alteram mensagem e issues locais. Evidência: `src/components/inventory/inventory-screen.tsx:38-83`.

**M8 — Sessão encerrada não bloqueia explicitamente o checkout.**  
`sessionEnded` é exibido, mas não participa de `checkoutDisabled`; outbox continua ativo no provider. Evidências: `src/components/pdv/pdv-screen.tsx:32,80-86,140-144`, `src/lib/offline/end-session.ts:4-13`.

**M9 — Estado de papel no client é editável.**  
Seletores de papel aparecem no PDV, inventário e dashboard; `PermissionGate` é apenas UX, conforme comentário. Evidências: `src/components/pdv/pdv-screen.tsx:121-134`, `src/components/inventory/inventory-screen.tsx:134-146`, `src/components/dashboard/dashboard-screen.tsx:35-47`, `permission-gate.tsx:1-4`.

**M10 — Seed e timestamps não fecham a trilha operacional.**  
`supabase/seed.sql:44-64` cria saldo inicial sem movimento de abertura; não há `CREATE TRIGGER` para manter `updated_at`, e `scripts/seed-auth.ts:61-79` não verifica os erros dos upserts. Evidências: arquivos citados e busca estrutural do repositório.

**M11 — Respostas e erros de integração não têm contrato runtime.**  
Rotas retornam `error.message` bruto do Supabase (`src/app/api/sales/process/route.ts:60-64` e rotas de inventário), enquanto o sync faz cast direto de `response.json()` (`src/lib/offline/sync-engine.ts:204-205`). Isso aumenta acoplamento e exposição de detalhes internos.

### BAIXO

**B1 — Divergência de documentação/versão.**  
README diz Next 14; `package.json` usa Next 16.3.4. Evidências: `README.md:5-11`, `package.json:16-23`.

**B2 — Depreciação e warnings de qualidade.**  
Build informa `middleware` depreciado; lint informa navegação por `window.location.href` e parâmetros não usados. Evidências: `src/middleware.ts`, `src/components/inventory/inventory-screen.tsx:124`, saída dos comandos.

**B3 — Metadado `fromCatalog` não reflete o estado.**  
`useProducts` inicializa/atualiza `fromCatalog` sempre como `false`, embora a UI tenha um label para catálogo local (`src/hooks/use-products.ts:19-56`, `pdv-screen.tsx:135-137`).

**B4 — Compatibilidade de parâmetros de página merece validação.**  
As páginas tipam `searchParams` como objeto síncrono (`src/app/dashboard/page.tsx:9-20`, `src/app/inventory/page.tsx:9-15`) enquanto o projeto foi atualizado para Next 16. O build passa, mas a semântica de filtros deve ser coberta por teste de runtime.

**B5 — Ambiente e documentação de integração estão desalinhados.**  
Não há workflow em `.github/`; a configuração do Vitest emite warning de ESM carregado como CommonJS, e o Node observado (`24.5.0`) está fora da faixa declarada para `jsdom` no lockfile (`pnpm-lock.yaml:1980-1982`).

## 6. Débitos Técnicos

1. Definir uma única fonte server-side de identidade/tenant/loja e remover a dependência autorizadora de campos autoeditáveis do perfil.
2. Aplicar autorização por coluna ou views/RPCs que impeçam `cost_price` para caixa; não confiar apenas no `select` da UI.
3. Revogar insert direto em `audit_logs` e aceitar eventos apenas por RPCs controladas.
4. Corrigir as policies `FOR ALL` de categorias para exigir papel autorizado também no `WITH CHECK`.
5. Adicionar constraints compostas ou triggers para manter `org_id` coerente com loja/produto/membership.
6. Namespacar IndexedDB, carrinho, outbox e metadados por organização/loja/usuário conforme o modelo de operador do terminal.
7. Persistir a identidade do operador na venda offline e definir política para logout com comandos pendentes.
8. Criar cache local versionado de catálogo, clientes necessários e saldo por loja, com atualização observável para a UI.
9. Corrigir o cursor de sync para ser por loja/tenant e usar paginação/high-water mark seguro.
10. Definir a máquina de estados completa para `failed`, `conflict`, retry manual e descarte auditado; liberar reservas ao entrar em estado terminal.
11. Congelar `unit_cost` no item da venda e definir alocação do desconto global para manter COGS/receita históricos.
12. Separar o SQL live obsoleto do material operacional ou removê-lo; manter uma única RPC canônica.
13. Implementar testes de integração Postgres com RLS e cenários cross-tenant/concorrência.
14. Criar fixture de autenticação E2E que funcione tanto com Supabase local quanto com o modo degradado, sem depender de redirect acidental.
15. Modelar caixa físico antes de afirmar que o produto cobre “gestão de caixa”.
16. Corrigir contratos monetários e de quantidade na fronteira: strings para BRL e escala `numeric(12,3)` para quantidade.
17. Completar paginação/exportação e atualizar a tela após ajustes.
18. Criar movimento de abertura para saldos seed, manter `updated_at` via trigger ou aplicação consistente e verificar falhas no seed-auth.

## 7. O que Deve ser Preservado

- `decimal.js` e strings com duas casas no domínio (`src/lib/money.ts`, `src/lib/domain/sale.ts`).
- Regras puras de carrinho em `src/lib/domain/sale-ops.ts`, especialmente rejeição de produto inativo, estoque vazio e desconto acima do limite.
- Separação entre adapter de pagamento, domínio e persistência.
- Fechamento local em transação Dexie única (`src/lib/offline/close-sale.ts`).
- `clientMutationId` imutável e compare-and-set do outbox (`src/lib/offline/outbox.ts`).
- Idempotência server-side por loja/mutation e recalculo dos valores no servidor (`20250901000002...sql`, `20250901000004...sql`).
- Locks `FOR UPDATE` e rollback transacional da RPC canônica.
- Bloqueio de estoque negativo por RPC + `CHECK`.
- Geração de `inventory_movements` para venda e ajuste, com motivo/papel no ajuste.
- RLS como enforcement real e `PermissionGate` tratado apenas como fallback visual.
- Escaping completo do recibo HTML e timezone `America/Sao_Paulo`.
- Tratamento de quota, conflitos visíveis e separação conceitual entre heartbeat e multi-tab lock.
- Proibição de service role no client e ausência de segredos de cartão no Zustand.
- Testes unitários de domínio e offline, que já capturam invariantes importantes.

## 8. Mapa de Dependências do PDV (representação textual)

```text
Supabase Auth / cookies
        │
        ├── middleware ──> /pdv, /inventory, /dashboard
        │
        └── getAuthedContext / auth.uid()
                              │
                              ├── profiles.default_role
                              └── store_members.role + store_id

Supabase products ──> useProducts ──> ProductSearch ──> ProductGrid
Supabase customers ─> useCustomers ─> CustomerDialog
                                      │
HID keyboard ─> HidScanAssembler ─────┘
                                      │
                                      ▼
                             cart-store (Zustand)
                         lines / discount / customer
                         persist: localStorage global
                                      │
             inventoryBalances (Dexie, projected stock)
                                      │
                                      ▼
                       sale-ops.validateSale / totals
                                      │
                 payment adapter (cash | not_configured)
                                      │
                                      ▼
                     closeSale (Dexie transaction rw)
              ┌──────────┬───────────┬───────────┬───────────┐
              │          │           │           │           │
            sales     saleItems   payments   inventory    outbox
                                      │
                                      ▼
                    SyncProvider / online / timer
                                      │
                         multi-tab lock + retry
                                      │
                                      ▼
                 POST /api/sales/process + Zod + Auth
                                      │
                                      ▼
                       RPC public.process_sale
                                      │
        ┌─────────┬────────┬────────────┬───────────┬──────────┐
        │         │        │            │           │
      sales   sale_items payments inventory_movements fiscal_documents
                                                    │
                                                    ▼
                                                audit_logs

GET /api/sync/changes ──> pullChanges ──> Dexie inventory + reconcile local sale
                                           │
                                           └── conflitos / banner / recibo

Ausente em todo o caminho:
cash_sessions, cash_movements, recebido/troco, refund, emissão fiscal real,
catalog cache local, registro efetivo do service worker e identidade offline.
```

## 9. Plano de Evolução (priorização lógica)

### Fase 0 — Contenção de segurança e integridade

1. Corrigir `profiles_update_own` para impedir alteração de papel/org pelo usuário.
2. Tornar membership e escopo de loja/org coerentes por constraint/policy.
3. Ocultar `cost_price` por coluna/view/RPC e revogar escrita direta de `audit_logs`.
4. Remover ou marcar inequivocamente o SQL live incompatível para impedir sobrescrita da RPC canônica.
5. Adicionar testes de RLS com usuário caixa, gerente, admin e duas organizações.

### Fase 1 — Fundamento local-first

1. Definir identidade do terminal e do operador no IndexedDB.
2. Namespacar carrinho/outbox/meta por org/loja e decidir o comportamento de logout.
3. Implementar cache versionado de catálogo/clientes e pull inicial explícito.
4. Fazer o pull emitir atualização observável de estoque e corrigir cursor por loja.
5. Corrigir a máquina de estados de `failed`/`conflict` e a restauração de reservas.

### Fase 2 — QA de fluxo real

1. Criar autenticação E2E determinística e separar cenário degradado de cenário Supabase.
2. Subir Supabase local em CI/ambiente de integração e executar migrations, seed, RPC e RLS reais.
3. Testar concorrência de venda/estoque, replay, logout, troca de loja e falhas de rede.
4. Cobrir rotas API e validar respostas de sync com schemas.

### Fase 3 — Correção financeira

1. Congelar custo no `sale_item`.
2. Corrigir strings monetárias nas rotas e escala de quantidade.
3. Completar CSV/exportação e definir atomicidade/idempotência de arquivo.
4. Atualizar dashboard após a correção histórica do COGS.

### Fase 4 — Caixa e operações comerciais

1. Modelar abertura/fechamento de caixa, sangria, suprimento, recebido, troco e divergência.
2. Associar pagamentos e eventos ao turno/caixa.
3. Só então evoluir cartão/Pix, fiscal e refund com adapters e trilhas auditáveis.

## 10. Próxima Tarefa Imediata

**Corrigir a autoridade server-side/RLS de identidade e tenant, bloqueando a autoalteração de `profiles.default_role` e `profiles.org_id`, e adicionar testes reais de isolamento.**

Justificativa: é o único item que pode permitir que um usuário autenticado se torne administrador ou atravesse a organização. Enquanto essa base não estiver fechada, qualquer evolução de inventário, dashboard, caixa ou pagamento pode ser construída sobre uma fronteira de segurança falsa.

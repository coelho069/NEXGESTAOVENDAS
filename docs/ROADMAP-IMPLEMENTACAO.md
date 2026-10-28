# Nex — Roadmap de implementação (engenharia)

Documento de tarefas ordenadas para evoluir o PDV Nex com base nas necessidades reais de varejo brasileiro.

**Estado atual (baseline):**
- Fiscal: apenas recibo HTML interno; status “não configurado” (sem NFC-e/NF-e).
- Pagamentos: sobretudo marcação manual (`debito_manual`, etc.); PIX/cartão automático desligados ou incompletos no PDV.
- Estoque: sync local corrigido (estoque “—” após sessão/refresh).
- LGPD: MVP no ar (política, exportar/anonimizar cliente, aba Privacidade).
- Infra recente: limpeza de disco, remoção de minerador/Supabase local; monitoramento periódico.

**Legenda de esforço:** S = 1–3 dias · M = ~1–2 semanas · L = 2+ semanas (ou epic multi-sprint).

**Como usar:** marcar checkboxes conforme conclusão; não iniciar epic sem resolver dependências listadas.

---

## Epic 1 — Desconto por % + UX do limite do cliente

**Status:** DONE (live) · **Esforço:** S · **Dependências:** nenhuma

### Objetivo
Operador aplica desconto em porcentagem; mensagens e limites do cliente ficam claros em R$ e %, sem “limite R$ 0,00” opaco.

### Tarefas
- [ ] Alterar UI do PDV: input de desconto com sufixo `%` (e opcional toggle R$ se útil).
- [ ] Converter % → valor em centavos no total da venda antes de validar/persistir.
- [ ] Alinhar validação de limite do cliente: comparar desconto proposto com limite cadastrado; se limite for em R$, converter % para R$ da venda atual (ou migrar limite para % — decidir e documentar).
- [ ] Mensagens em pt-BR: `Desconto excede o limite permitido para o cliente (R$ X,XX)` / `(Y%)` conforme regra escolhida.
- [ ] Cadastro de cliente: campo de limite editável e visível; hint quando limite = 0 (“qualquer desconto será bloqueado”).
- [ ] Testes unitários da conversão e da validação; smoke no PDV (venda com cliente limite 0, 10%, 100%).

### Critérios de aceite
- [ ] Operador consegue aplicar desconto 10% e ver total correto.
- [ ] Cliente com limite R$ 0,00 (ou 0%) bloqueia desconto com mensagem clara e acionável.
- [ ] Recibo/resumo mostram desconto em formato brasileiro (R$ / %).
- [ ] Sem regressão no fluxo de venda offline/sync.

### Próximos passos imediatos (Epic 1)
1. Localizar componentes de desconto no PDV e a API/regra `discount_limit` do cliente.
2. Definir se o limite do cliente fica em R$, em % ou ambos.
3. Implementar UI % + validação + mensagens; deploy atômico (build em pasta temp, swap) para não quebrar CSS/estáticos.

---

## Epic 2 — Caixa (abertura / sangria / suprimento / fechamento)

**Status:** DONE (UI polish 2026-10-15) · **Esforço:** M · **Dependências:** nenhuma crítica

### Objetivo
Controle de caixa por turno com conferência, responsável e histórico.

### Tarefas
- [x] Modelo de dados: sessão de caixa (loja, operador, abertura, status, saldos).
- [x] Abertura de caixa com valor inicial obrigatório.
- [x] Sangria e suprimento com motivo, valor e auditoria.
- [x] Fechamento com contagem informada × esperado; diferença registrada.
- [x] Bloquear (ou avisar) venda se caixa não estiver aberto (aviso no PDV + gate em dinheiro).
- [x] Relatório simples do turno (entradas/saídas/vendas).
- [x] Permissão mínima: quem abre/fecha/sangra via `canUsePdv` (endurecer no Epic 8).

### Critérios de aceite
- [x] Operador abre caixa, vende, sangra, fecha com diferença visível.
- [x] Histórico do turno no painel (movimento + tipo + horário).
- [x] Valores em pt-BR (aceita vírgula); diferença prevista antes do fechamento.

---

## Epic 3 — PIX com QR na tela + integração de cartão

**Status:** IN PROGRESS (scaffold) · **Esforço:** L · **Dependências:** credenciais Mercado Pago (ou TEF); webhooks estáveis

**Já existe no código:** `pix-qr-sheet.tsx`, adapters MP/Stripe, `/api/payments/pix`, helpers `src/lib/domain/pix-pdv.ts` (labels/status).

### Objetivo
Pagamento ágil no PDV: QR PIX automático e cartão com confirmação clara (não só marcação manual).

### Tarefas
- [ ] Fluxo PDV: escolher PIX → gerar cobrança → exibir QR + copia-e-cola → polling/webhook → confirmar venda.
- [ ] Cartão: integração TEF ou fluxo MP; estados `pendente / confirmado / falhou / estornado` com labels pt-BR (como no recibo).
- [ ] Manter fallback “manual” para contingência (sem internet / provedor fora).
- [ ] Idempotência: não duplicar venda se webhook chegar 2×.
- [ ] Tratar rejeições de webhook (hoje há ruído) — logs e fila de retry.
- [ ] Configuração segura de chaves (env + UI admin); nunca expor secret no client.
- [ ] Timeout e cancelamento de cobrança PIX abandonada.

### Critérios de aceite
- [ ] Venda PIX completa no caixa com QR na tela e status automático.
- [ ] Recibo mostra “PIX · Confirmado” (não raw status).
- [ ] Offline: fallback manual documentado; sync não quebra estoque.
- [ ] Smoke de regressão em produção sem derrubar PDV.

---

## Epic 4 — NFC-e + contingência

**Esforço:** L · **Dependências:** CNPJ/IE, certificado, provedor SEFAZ; Epic 3 desejável mas não bloqueante

### Objetivo
Emissão fiscal real no fluxo da venda; recibo deixa de ser o único documento.

### Tarefas
- [ ] Escolher/plugar provedor (`FISCAL_PROVIDER*` já previstos no env).
- [ ] UI Configurações: CNPJ, IE, endereço, CSC/token, certificado A1, homologação vs produção.
- [ ] Emitir NFC-e ao finalizar venda (assíncrono via outbox/worker).
- [ ] Contingência offline: fila local → envio ao voltar internet.
- [ ] Cancelamento / inutilização / consulta de status.
- [ ] Recibo: link/chave de acesso ou “pendente SEFAZ” em vez de “não configurado” genérico.
- [ ] Homologação por UF; checklist de go-live fiscal.

### Critérios de aceite
- [ ] Em homologação, venda gera NFC-e autorizada e status visível no PDV.
- [ ] Sem internet: venda não trava; documento entra em contingência e sincroniza depois.
- [ ] Erros SEFAZ legíveis para o operador/suporte.

---

## Epic 5 — Relatórios em tempo real

**Esforço:** M · **Dependências:** dados de venda/caixa estáveis (Epics 2–3 ajudam)

### Objetivo
Painéis do dia: vendas, top produtos, ticket médio, por vendedor, horários de pico.

### Tarefas
- [ ] API agregada por período/loja (com índices adequados).
- [ ] Dashboard: vendas do dia, ticket médio, ranking produtos, por operador.
- [ ] Filtros: loja, data, vendedor; export CSV.
- [ ] Cache curto ou realtime leve (sem matar DB).
- [ ] Permissão: só gestores veem relatórios sensíveis (Epic 8).

### Critérios de aceite
- [ ] Gestor vê números do dia atualizados em poucos segundos após vendas.
- [ ] Export e filtros funcionam; pt-BR em moeda/datas.

---

## Epic 6 — Alertas de estoque + visão multi-loja

**Esforço:** M · **Dependências:** sync de estoque já corrigido (baseline)

### Objetivo
Não vender no escuro: mínimo, ruptura e saldo por loja.

### Tarefas
- [ ] Campo estoque mínimo por produto/loja; job ou check na venda.
- [ ] Alertas na UI (badge, lista “abaixo do mínimo”).
- [ ] Visão consolidada multi-loja + drill-down por loja.
- [ ] Reserva/baixa consistente com PDV offline.
- [ ] Notificação opcional (e-mail `suporte@` / in-app) para gestores.

### Critérios de aceite
- [ ] Produto abaixo do mínimo aparece em alerta sem atraso relevante.
- [ ] Multi-loja mostra saldos corretos pós-sync.

---

## Epic 7 — Promoções automáticas

**Esforço:** M · **Dependências:** Epic 1 (motor de desconto); regras claras com limite do cliente

### Objetivo
Promoções %/R$/combo/horário aplicadas sem o operador decorar regra.

### Tarefas
- [ ] CRUD de promoções (vigência, lojas, produtos/categorias).
- [ ] Motor no PDV: aplica melhor regra (ou stacking documentado).
- [ ] Convivência com desconto manual e limite do cliente.
- [ ] Auditoria: qual promoção bateu na venda.

### Critérios de aceite
- [ ] Produto em promoção aplica desconto sozinho no carrinho.
- [ ] Fora da vigência, não aplica; recibo mostra promoção.

---

## Epic 8 — Permissões finas

**Esforço:** M · **Dependências:** Epics 2 e 5 (caixa e relatórios); papéis já existentes no app

### Objetivo
Quem desconta, cancela, sangra, vê relatório — por papel.

### Tarefas
- [ ] Matriz de permissões (admin, gestor, operador, caixa).
- [ ] Gates no backend (não só esconder botão).
- [ ] Override com senha de gestor para desconto acima do limite.
- [ ] UI admin para editar papéis.

### Critérios de aceite
- [ ] Operador sem permissão não consegue sangria/cancelamento via API.
- [ ] Auditoria registra override de gestor.

---

## Epic 9 — PDV mobile / tablet

**Esforço:** L · **Dependências:** Epics 1–3 estáveis; layout responsivo do PDV

### Objetivo
Venda assistida na loja (tablet/smartphone) com os mesmos fluxos críticos.

### Tarefas
- [ ] Layout touch: botões grandes, scanner câmera se viável.
- [ ] Offline mobile parity com PWA/service worker.
- [ ] Testes em Android/iOS Safari + Chrome.
- [ ] Performance: first paint rápido em 4G.

### Critérios de aceite
- [ ] Venda completa (produto → pagamento → recibo) em tablet.
- [ ] Offline básico funciona; sync ao reconectar.

---

## Epic 10 — Self-checkout

**Esforço:** L · **Dependências:** Epics 3, 4, 8, 9; PIX/NFC-e confiáveis

### Objetivo
Totem/autoatendimento reduzindo fila no caixa fixo.

### Tarefas
- [ ] Modo kiosk (UI simplificada, sem painéis admin).
- [ ] Fluxo: escanear → pagar (PIX/cartão) → emitir fiscal → comprovante.
- [ ] Escalonamento para atendente (ajuda / item restrito / erro).
- [ ] Hardening: sessão, timeout, permissões mínimas.

### Critérios de aceite
- [ ] Cliente conclui compra sem operador em caminho feliz.
- [ ] Falhas redirecionam para assistência sem corromper estoque/caixa.

---

## Epic 11 — Integrações (ERP, e-commerce, TEF, delivery, contábil)

**Esforço:** L · **Dependências:** APIs estáveis de venda/estoque/fiscal (Epics 3–6)

### Objetivo
Conectar Nex ao ecossistema da loja sem retrabalho manual.

### Tarefas
- [ ] Contratos de webhook/API outbound (venda, estoque, cliente).
- [ ] Conectores prioritários: TEF, 1 ERP, 1 e-commerce ou delivery.
- [ ] Mapeamento fiscal/contábil exportável.
- [ ] Painel de status de integração + reprocessamento.

### Critérios de aceite
- [ ] Pelo menos uma integração ponta a ponta em produção com retry e log.
- [ ] Falha externa não derruba o PDV.

---

## Epic 12 — Preparação IBS/CBS (Reforma Tributária)

**Esforço:** M–L · **Dependências:** Epic 4 (NFC-e); layouts SEFAZ atualizados

### Objetivo
Campos e emissão prontos para IBS/CBS sem trocar o sistema.

### Tarefas
- [ ] Modelar campos tributários novos nos itens/venda.
- [ ] Acompanhar layouts NFC-e da UF; feature flags.
- [ ] Atualizar provedor fiscal e testes de homologação.
- [ ] Documentação para o lojista (o que muda na operação).

### Critérios de aceite
- [ ] Em ambiente de testes com layout novo, XML/payload aceito.
- [ ] Feature flag desligável se UF atrasar.

---

## Epic 13 — Operação de suporte (sync, fila de erros, canal)

**Esforço:** M · **Dependências:** útil em paralelo desde Epic 3; formalizar após baseline estável

### Objetivo
Quando quebrar no expediente, diagnóstico rápido — dor frequente de PDV.

### Tarefas
- [ ] Painel: status de sync (última sync, pendências, conflitos).
- [ ] Fila de erros (webhook, fiscal, estoque) com retry manual.
- [ ] Health checks expostos para suporte (`suporte@nexgestaovendas.com.br`).
- [ ] Runbook: minerador/CPU, disco, deploy atômico, senha/chave SSH.
- [ ] Alertas proativos (site down, sync atrasado, fila crescendo).

### Critérios de aceite
- [ ] Suporte identifica “pendente sync / falha webhook / fiscal” em &lt; 2 minutos pela UI/logs.
- [ ] Retry não duplica venda nem estoque.

---

## Ordem recomendada de execução

| Ordem | Epic | Esforço | Pode paralelizar? |
|------:|------|---------|-------------------|
| 1 | Desconto % + limite cliente | S | — |
| 2 | Caixa completo | M | Parcial com 1 |
| 3 | PIX QR + cartão | L | Após 2 ou em paralelo se time &gt; 1 |
| 4 | NFC-e + contingência | L | Após definição fiscal; paralelo a 5 |
| 5 | Relatórios realtime | M | Paralelo a 4 |
| 6 | Alertas estoque + multi-loja | M | Paralelo a 5 |
| 7 | Promoções automáticas | M | Após 1 |
| 8 | Permissões | M | Após 2 (e idealmente 5) |
| 9 | PDV mobile | L | Após 1–3 estáveis |
| 10 | Self-checkout | L | Após 3, 4, 8, 9 |
| 11 | Integrações | L | Após APIs estáveis |
| 12 | IBS/CBS | M–L | Após 4 |
| 13 | Suporte ops | M | Contínuo / paralelo cedo |

---

## Notas de deploy (obrigatório)

- **Não** fazer `next build` direto sobre a pasta de produção (já causou CSS/JS sumindo).
- Usar deploy atômico: build em diretório temporário → validar assets → swap → restart controlado.
- Após incidente de segurança: preferir chave SSH; rotacionar secrets (Supabase, Mercado Pago, SMTP).

---

*Gerado para acompanhamento de engenharia do Nex · suporte: suporte@nexgestaovendas.com.br*

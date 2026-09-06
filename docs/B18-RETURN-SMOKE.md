# B18 — checklist de fumaça (cancelar / devolver)

Hotfix cirúrgico do caminho de devolução/cancelamento sobre `production`.
As migrations B18 **já estão aplicadas** no Supabase de produção — **não** rode `supabase db push` nem reaplique SQL.

## Pré-condições

1. Operador autenticado com membership na loja (`admin` / `manager` / `cashier`).
2. Caixa **aberto** no mesmo terminal da venda.
3. Venda `confirmed` (ou `partially_refunded` para nova devolução parcial).
4. Pagamento MVP: `cash`. Cancelamento total exige `manager` ou `admin`.

## Fluxo feliz (mesma sessão de caixa)

1. Abrir caixa no PDV.
2. Vender item em dinheiro (ex.: BEV-001).
3. Consultar vendas → abrir a venda → **Devolver** (parcial) ou **Cancelar venda** (total).
4. Confirmar motivo + quantidades.
5. Verificar:
   - estoque sobe pela quantidade devolvida;
   - movimento `refund_cash` na **mesma** `cash_session_id` da venda (valor negativo);
   - venda vai para `partially_refunded` / `refunded` / `cancelled`;
   - dashboard/relatório deixa de contar a venda estornada (RPC `get_dashboard_metrics` só considera vendas confirmadas).

## Idempotência

Repetir o mesmo `client_mutation_id` deve devolver o mesmo `return_id` (`replay: true`) sem novo movimento de caixa/estoque.

## Regra obrigatória — caixa cruzado

`refund_cash` **só** pode ir para a `cash_session_id` original da venda, e essa sessão precisa estar **aberta** no **mesmo terminal**.

Se a sessão original estiver fechada, ausente, ou o terminal não bater:

- API responde **422** `cash_session_closed_for_refund`
- mensagem: operador deve usar um **ajuste de caixa explícito**
- **não** lançar estorno no caixa aberto de hoje

A API valida isso **antes** do RPC, porque `process_sale_return` aceita a sessão do payload (desde que aberta) e `get_cash_session` devolve a sessão **mais recente** do terminal — não a da venda.

## Fora deste hotfix

- PIX/cartão real, NFC-e/SAT, settings, impressora, backup, UI de auditoria (B19–B28).
- E2E de troco (`cash-received-input`) depende do UX de tender ainda não portado.

# Stripe card — checklist de fumaça (testmode)

Cartão entra atrás do `PaymentAdapter` (`authorize` / `capture` / `cancel` / `reconcile`).
Dinheiro e caixa **não mudam**. PIX/TEF/Connect/livemode ficam fora.

## Pré-condições

1. Secrets **server-only** no ambiente (nunca `NEXT_PUBLIC_*`):

   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

2. Migration `20260906220000_stripe_card_payment.sql` aplicada.
3. `SUPABASE_SERVICE_ROLE_KEY` disponível no servidor (webhook + transição `captured`).
4. Operador autenticado com membership na loja.
5. Health probe Stripe (`GET /v1/balance`) ok. Sem health → `card=not_configured`.

## Health

```
GET /api/payments/card
```

Esperado: `{ configured: true, testmode: true }` somente após probe ok.
Falha de rede/chave/livemode → `{ configured: false }` e o PDV mantém cartão como rascunho (`não configurado`) ou cai para dinheiro.

## Authorize ≠ venda confirmada

```
POST /api/payments/card
{ "action": "authorize", "store_id", "amount": "10.00", "client_mutation_id", "items": [...] }
```

Esperado:

- `status=authorized`
- `provider_reference=pi_...` (PaymentIntent id)
- venda **não** `confirmed`
- pagamento **não** `captured`

Testmode confirma com `pm_card_visa` e `capture_method=manual`.

## Capture + silent failure

```
POST /api/payments/card
{ "action": "capture", "store_id", "amount": "10.00", "client_mutation_id", "provider_reference": "pi_..." }
```

Esperado:

- PI `succeeded` **e** `sale_confirmed=true` → pagamento `captured`, venda `confirmed`
- HTTP 200 **sem** PI `succeeded` (processing / corpo vazio / timeout) → `status=unknown`, venda **não** confirmada
- Falha Stripe → nunca marcar sucesso; UI oferece dinheiro

## Webhook

Endpoint: `POST /api/payments/stripe/webhook`

1. Sem `Stripe-Signature` → **400** `stripe_webhook_unsigned`
2. Assinatura inválida → **400**
3. Allowlist: `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`
4. Idempotência por `event.id` (`card_provider_events`)
5. Stripe CLI (testmode):

   ```
   stripe listen --forward-to localhost:3000/api/payments/stripe/webhook
   stripe trigger payment_intent.succeeded
   ```

## Reconcile

```
POST /api/payments/reconcile
{ "store_id", "client_mutation_id" }
```

Regras:

- `PaymentIntent.id` ≡ `payments.external_reference` / `card_payment_intents.provider_ref`
- amount + `brl` devem bater
- `captured` local **somente** se PI `succeeded`
- mismatch → `unknown` (nunca captured)

## Estorno card

Devolução B18 de venda card grava `payment_refund_status=pending_external`.
Webhook/reconcile de refund pode concluir para `completed`.
**Nunca** criar `refund_cash` para cartão.

## Fora deste checklist

PIX via Stripe, TEF, Connect, cutover livemode, alteração das RPCs de dinheiro.

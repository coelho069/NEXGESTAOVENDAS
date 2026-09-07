# Stripe PIX — checklist de fumaça (testmode)

PIX entra atrás do `PaymentAdapter` como **rail irmão** do cartão (`create` / `cancel` / `reconcile`).
Dinheiro, caixa e `CARD_CHECKOUT_ENABLED` **não mudam**. Sem livemode, TEF ou Connect.

`pending` (QR) **não** confirma a venda. Venda só em PI `succeeded` + `process_pix_sale`.

## Pré-condições

1. Secrets **server-only** no ambiente (nunca `NEXT_PUBLIC_*`):

   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

2. Migration `20260907220000_stripe_pix_payment.sql` aplicada.
3. `SUPABASE_SERVICE_ROLE_KEY` disponível no servidor (webhook + `process_pix_sale`).
4. Operador autenticado com membership na loja.
5. `PIX_CHECKOUT_ENABLED` permanece **unset/false** até os logs abaixo passarem.

## Log1 — health hold

```
GET /api/payments/pix
```

Com `PIX_CHECKOUT_ENABLED` unset ou `false`:

- `{ configured: false, testmode: false, method: "pix" }`
- PDV: botão PIX desabilitado (`não configurado`)
- Stripe **não** é chamado
- Cash e cartão permanecem no comportamento anterior (`CARD_CHECKOUT_ENABLED` intacto)

Só depois do smoke: `PIX_CHECKOUT_ENABLED=true` + probe ok → `{ configured: true, testmode: true }`.

## Log2 — create ≠ sale; succeeded = confirmed

```
POST /api/payments/pix
{ "action": "create", "store_id", "amount": "10.00", "client_mutation_id", "items": [...] }
```

Esperado:

- `status=pending`
- `sale_confirmed=false`
- `provider_reference=pi_...`
- `qr.data` / `qr.imageUrlPng` presentes (next_action PIX)
- venda **não** `confirmed`
- pagamento **não** `captured`

Create Stripe usa `payment_method_data.type=pix` (não `payment_method_types`) e **sem** `capture_method=manual`.

Depois do PI `succeeded` (webhook ou `POST /api/payments/reconcile`):

- `process_pix_sale` → venda `confirmed`
- pagamento `method=pix`, `status=captured`

HTTP 200 **sem** PI `succeeded` → `status=unknown`, venda **não** confirmada.

## Log3 — webhook + reconcile

Mesmo endpoint do cartão: `POST /api/payments/stripe/webhook`

1. Sem `Stripe-Signature` → **400** `stripe_webhook_unsigned`
2. Assinatura inválida → **400**
3. PI PIX (`payment_method_types` inclui `pix` ou intent em `pix_payment_intents`) → RPCs PIX
4. PI cartão → RPCs card **inalteradas**
5. Idempotência por `event.id` (`pix_provider_events`)
6. Reconcile:

   ```
   POST /api/payments/reconcile
   { "store_id", "client_mutation_id" }
   ```

   Tenta card; se não houver intent card, tenta PIX. `captured` local só com PI `succeeded`.

## Estorno PIX (B18)

Devolução de venda PIX grava `payment_refund_status=pending_external`.
Webhook/reconcile de refund pode concluir para `completed`.
**Nunca** criar `refund_cash` para PIX.

## Deploy

Seguir o checklist atômico em `docs/ATOMIC_DEPLOY.md` (#9).
Não ligar `PIX_CHECKOUT_ENABLED=true` no mesmo corte do deploy da migration — hold até Log2 passar.

## Fora deste checklist

Cartão (rail separado), TEF, Connect, cutover livemode, alteração das RPCs de dinheiro.

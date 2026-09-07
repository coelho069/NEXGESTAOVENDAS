# Stripe PIX — locked smoke acceptance

## This cut (merge / deploy now)

Ship the sibling migration + app with **`PIX_CHECKOUT_ENABLED` unset/false**.
The PIX button stays dead (`não configurado`). **Do not flip the flag** on
this deploy. Cash and `CARD_CHECKOUT_ENABLED` stay as they are.

Deploy with checklist **#9**: `docs/ATOMIC_DEPLOY.md`
(stop → build → copy static → check script → start → readiness + sample chunk).

PIX is a **sibling rail** of card (`create` / `cancel` / `reconcile`). Cash, caixa,
and `CARD_CHECKOUT_ENABLED` stay untouched. No livemode, TEF, or Connect.

**`PIX_CHECKOUT_ENABLED` must stay unset/false until every gate below is green.**
Never default the flag to `true` in `.env.example`, CI, Docker, or deploy.
Opt-in is the literal string `true` only (`"TRUE"`, `"1"`, `"yes"` stay hold).

Automated lock: `tests/unit/stripe-pix-smoke-lock.test.tsx` (plus hold/health
unit tests). Do not flip the flag because a single log looked fine.

`pending` (QR) **is not** a confirmed sale. Sale confirms only on PI `succeeded`
+ `process_pix_sale`. Fail / amount / provider mismatch → `unknown`, never
`confirmed`.

## Pré-condições (ainda com o flag off)

1. Secrets **server-only** (nunca `NEXT_PUBLIC_*`):

   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

2. Migration `20260907220000_stripe_pix_payment.sql` aplicada.
3. `SUPABASE_SERVICE_ROLE_KEY` no servidor (webhook + `process_pix_sale`).
4. Operador autenticado com membership na loja.

## Gate 1 — Health hold / `not_configured`; online only with secrets+flag

```
GET /api/payments/pix
```

With `PIX_CHECKOUT_ENABLED` unset or not exactly `true`:

- `{ configured: false, testmode: false, method: "pix", reason: "pix_checkout_hold" }`
- Stripe is **not** probed
- PDV: PIX button disabled (`não configurado`)

With flag `true` but missing secrets or failed probe:

- `{ configured: false, testmode: false }` / `not_configured`
- PIX stays disabled

Selectable only when **all** of these are true:

1. `PIX_CHECKOUT_ENABLED=true`
2. Stripe secrets present and health probe ok (`configured` + `testmode`)
3. Browser **online** (offline PIX is draft / disabled — never a local confirmed sale)

## Gate 2 — Create → `pending` ≠ sale confirmed

```
POST /api/payments/pix
{ "action": "create", "store_id", "amount": "10.00", "client_mutation_id", "items": [...] }
```

Expected (even with flag on and secrets):

- `status=pending`
- `sale_confirmed=false`
- `provider_reference=pi_...`
- `qr.data` / `qr.imageUrlPng` from `next_action`
- sale **not** `confirmed`
- payment **not** `captured`
- `process_pix_sale` **not** called on create

Create Stripe uses `payment_method_data.type=pix` (not `payment_method_types`)
and **no** `capture_method=manual`.

## Gate 3 — `succeeded` / webhook → `process_pix_sale`; fail / mismatch → `unknown`

Same endpoint as card: `POST /api/payments/stripe/webhook`

1. No `Stripe-Signature` → **400** `stripe_webhook_unsigned`
2. Invalid signature → **400**
3. PI PIX (`payment_method_types` includes `pix` or row in `pix_payment_intents`)
   → PIX RPCs
4. Card PI → card RPCs **unchanged**
5. Idempotency by `event.id` (`pix_provider_events`)

On `payment_intent.succeeded` with a matching PIX intent:

- `apply_pix_provider_event` then `process_pix_sale`
- sale `confirmed`, payment `method=pix` / `status=captured`
- `sale_confirmed=true`

On fail or mismatch (do **not** confirm):

- `payment_intent.payment_failed` → `status=unknown`, no `process_pix_sale`
- amount / currency / `provider_ref` mismatch on reconcile → `unknown`
- `succeeded` without a matching PIX intent → `unknown`
- `process_pix_sale` error / amount mismatch → `unknown`
- HTTP 200 without PI `succeeded` → `unknown`

Reconcile:

```
POST /api/payments/reconcile
{ "store_id", "client_mutation_id" }
```

Tries card first; if no card intent, tries PIX. Local `captured` only with PI
`succeeded` and a confirmed `process_pix_sale`.

## Gate 4 — Cash + card regression intact

With PIX hold (flag off):

- Cash checkout still `configured` / button enabled
- Card still gated only by `CARD_CHECKOUT_ENABLED` + card health (unchanged)
- Card webhook / `card_payment_intents` / `process_card_sale` not rewritten
- PIX button remains disabled

Do not change cash RPCs, Dexie/sync, or card hold semantics to ship PIX.

## Estorno PIX (B18)

PIX refund writes `payment_refund_status=pending_external`.
Webhook/reconcile of refund may complete to `completed`.
**Never** invent `refund_cash` for PIX.

## Deploy

Follow `docs/ATOMIC_DEPLOY.md` (#9). Deploy migration + app with
`PIX_CHECKOUT_ENABLED` **unset/false**. Flip the flag only after Gates 1–4
are green in testmode. Never bake `PIX_CHECKOUT_ENABLED=true` into defaults.

## Fora deste checklist

Livemode Stripe keys, TEF, Connect, cash RPC changes, card rail changes,
landing/SaaS claims.

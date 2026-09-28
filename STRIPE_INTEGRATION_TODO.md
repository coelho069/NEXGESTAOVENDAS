# Stripe Checkout Studio — Embedded Form (Integração) TODO

Integração do **Embedded Form** (Stripe Checkout Studio) no NEXGESTAOVENDAS.
Caminho: card / Checkout Studio. **Não** substitui PIX, `payment-fallback`,
Mercado Pago ou fiscal — coexiste com eles.

---

## Values to Replace

| Ref | Campo | Valor atual | Ação |
|---|---|---|---|
| `src/lib/server/public-stripe-checkout.ts` | `line_items[].price` | `stripePriceId` (resolvido via `STRIPE_PRICE_PLAN_<SLUG>`) | **Preserve** — Price ID real por plano. Mapear via env `STRIPE_PRICE_PLAN_<SLUG>=price_...`. |
| `.env.example` → `.env.local` | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_placeholder` (comentado) | Descomentar + trocar por `pk_test_...` real. |
| `.env.local` | `STRIPE_SECRET_KEY` | (server-only) | `sk_test_...` — nunca commitar. |
| `.env.local` | `STRIPE_WEBHOOK_SECRET` | (server-only) | `whsec_...` — nunca commitar. |

**mode:** `subscription` (assinatura recorrente — preservado).

**line_items:** Price IDs reais (não há `price_...` hardcoded no código — o server
resolve por `STRIPE_PRICE_PLAN_<SLUG>`). Qualquer placeholder `price_...` a definir
ficaria aqui: (nenhum — usa env).

---

## Configured Parameters (fixed_by_ui aplicados)

| Param | Valor | Path |
|---|---|---|
| `ui_mode` | `"form"` (SDK >= 21.0.0; instalado 22.6.1) | `src/lib/server/public-stripe-checkout.ts` |
| `billing_address_collection` | `"auto"` | idem |
| `phone_number_collection` | `{ enabled: false }` | idem |
| `automatic_tax` | `{ enabled: false }` | idem |
| `payment_method_collection` | `"always"` (somente modo subscription) | idem |
| `submit_type` | `"auto"` | idem |
| `saved_payment_method_options` | `{ payment_method_save: "enabled" }` | idem |
| `integration_identifier` | `"custom_embedded_web_0001"` | idem |
| `mode` | `subscription` (preserve) | idem |
| `line_items` | Price real (preserve) | idem |
| `apiVersion` (server Stripe) | `2026-03-25.dahlia; custom_checkout_payment_form_preview=v1` | `src/lib/server/stripe-card.ts` |
| `Stripe.js` (client) | `https://js.stripe.com/dahlia/stripe.js` | `src/components/marketing/stripe-embedded-checkout.tsx` |
| `betas` (client) | `["custom_checkout_payment_form_1"]` | idem |
| `appearance` (exata) | ver `EMBEDDED_FORM_APPEARANCE` no componente | idem |
| Container | `#checkout-form` + `createForm({ layout: "expanded" })` | idem |

---

## Setup (env)

- `STRIPE_SECRET_KEY` (server-only, `sk_test_...` / `sk_live_...`) — nunca `NEXT_PUBLIC_`.
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_test_...` / `pk_live_...`) — exposto no client.
- `STRIPE_WEBHOOK_SECRET` (`whsec_...`) — webhook exists: `/api/payments/stripe/webhook`.
- `STRIPE_PRICE_PLAN_<SLUG>` para cada plano Stripe (ex. `STRIPE_PRICE_PLAN_ESSENCIAL=price_...`).
- `DOMAIN` / `APP_ORIGIN` reutilizados onde já existirem.

---

## Fluxo

```
POST /api/subscriptions/stripe/public-checkout
  → cria Checkout Session (mode=subscription, ui_mode=form, ...fixed_by_ui)
  → responde { client_secret }
Client
  → carrega https://js.stripe.com/dahlia/stripe.js (não bundle)
  → Stripe(pk, { betas: ['custom_checkout_payment_form_1'] })
  → fetch client_secret do endpoint
  → initCheckoutFormSdk({ clientSecret, appearance })
  → container #checkout-form → createForm({ layout: "expanded" }) → mount
  → loadActions → form.on("confirm") → actions.confirm
```

---

## Cards de teste (Stripe)

- `4242 4242 4242 4242` — sucesso
- `4000 0000 0000 0002` — declinado
- `4000 0025 0000 3155` — requer autenticação (3DS)
- Expiração futura qualquer / CVC qualquer / CEP qualquer no testmode.

---

## Next steps

- Preencher `pk_test_...`/`sk_test_...` (nunca commitar) e mapear Price IDs por `STRIPE_PRICE_PLAN_<SLUG>`.
- Smoke: POST session → client_secret → iframe dahlia monta → `confirm` → webhook `checkout.session.completed` roda onboarding.
- NÃO ligar `STRIPE_PIX_ENABLED` neste passo.

---

## Docs

- https://support.stripe.com
- https://docs.stripe.com/mcp

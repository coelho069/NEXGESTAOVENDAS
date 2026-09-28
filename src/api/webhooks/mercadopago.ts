/**
 * Mercado Pago Checkout Pro webhook entrypoint (mp_webhook_approved).
 * HTTP handler lives at:
 * src/app/api/subscriptions/mercadopago/public-checkout/webhook/route.ts
 */
export {
  applyMercadoPagoCheckoutProWebhookEvent,
  type MercadoPagoCheckoutProWebhookApplyResult,
} from "@/lib/server/mercadopago-checkout-pro-webhook";

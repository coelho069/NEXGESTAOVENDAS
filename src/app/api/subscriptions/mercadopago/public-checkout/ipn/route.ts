import { NextResponse } from "next/server";
import { parseMercadoPagoPaymentIpn } from "@/lib/domain/mercadopago-payment-ipn";
import {
  getMercadoPagoEnv,
  isMercadoPagoCheckoutEnabled,
} from "@/lib/server/mercadopago";
import { applyMercadoPagoCheckoutProWebhookEvent } from "@/lib/server/mercadopago-checkout-pro-webhook";
import { clientRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";
import { rateLimitedResponse } from "@/lib/security/safe-error";
import {
  createRequestObservability,
  observeApiResult,
} from "@/lib/observability/request-context";

/**
 * IPN legado do Mercado Pago (`topic=payment&id=`), inclusive o POST na raiz.
 * Não há assinatura nesse formato. O pagamento só gera acesso depois que a
 * API do Mercado Pago confirma status approved e a referência da sessão.
 */
async function readIpnNotification(request: Request) {
  const url = new URL(request.url);
  const fromQuery = parseMercadoPagoPaymentIpn(
    url.searchParams.get("topic"),
    url.searchParams.get("id")
  );
  if (fromQuery || request.method === "GET") return fromQuery;

  const text = await request.text();
  if (text.length === 0 || text.length > 8_000) return null;
  const form = new URLSearchParams(text);
  return parseMercadoPagoPaymentIpn(form.get("topic"), form.get("id"));
}

async function handleIpn(request: Request) {
  const obs = createRequestObservability(
    request,
    "subscriptions.mercadopago.public-checkout.ipn"
  );

  if (!isMercadoPagoCheckoutEnabled()) {
    observeApiResult(obs, "server_error", { error: "mercadopago_checkout_pro_webhook_not_configured" });
    return obs.withHeaders(
      NextResponse.json({ error: "mercadopago_checkout_pro_webhook_not_configured" }, { status: 503 })
    );
  }

  const env = getMercadoPagoEnv();
  if (!env.configured) {
    observeApiResult(obs, "server_error", { error: "mercadopago_checkout_pro_webhook_not_configured" });
    return obs.withHeaders(
      NextResponse.json({ error: "mercadopago_checkout_pro_webhook_not_configured" }, { status: 503 })
    );
  }

  const rate = consumeRateLimit({
    key: clientRateLimitKey(request, "mercadopago-checkout-pro-ipn", "mercadopago"),
    limit: 120,
    windowMs: 60_000,
  });
  if (!rate.allowed) return obs.withHeaders(rateLimitedResponse(rate.retryAfterSec));

  const notification = await readIpnNotification(request);
  if (!notification) {
    observeApiResult(obs, "rejected", { error: "mercadopago_ipn_invalid" });
    return obs.withHeaders(NextResponse.json({ error: "mercadopago_ipn_invalid" }, { status: 400 }));
  }

  let result: Awaited<ReturnType<typeof applyMercadoPagoCheckoutProWebhookEvent>>;
  try {
    result = await applyMercadoPagoCheckoutProWebhookEvent(notification, {
      correlationId: obs.correlationId,
    });
  } catch {
    observeApiResult(obs, "server_error", {
      eventId: notification.id,
      type: notification.type,
      error: "mercadopago_checkout_pro_webhook_processing_failed",
    });
    return obs.withHeaders(
      NextResponse.json(
        {
          error: "mercadopago_checkout_pro_webhook_processing_failed",
          event_id: notification.id,
          retryable: true,
        },
        { status: 503 }
      )
    );
  }

  if (result.retryable) {
    observeApiResult(obs, "server_error", {
      eventId: notification.id,
      type: notification.type,
      error: "mercadopago_checkout_pro_webhook_retryable",
    });
    return obs.withHeaders(
      NextResponse.json(
        {
          error: "mercadopago_checkout_pro_webhook_retryable",
          event_id: notification.id,
          retryable: true,
        },
        { status: 503 }
      )
    );
  }

  observeApiResult(obs, "ok", {
    eventId: notification.id,
    type: notification.type,
    replay: result.replay === true,
    ignored: result.ignored === true,
    paymentId: result.payment_id,
  });

  return obs.withHeaders(
    NextResponse.json({
      ok: true,
      event_id: notification.id,
      type: notification.type,
      payment_id: result.payment_id,
      replay: result.replay === true,
      ignored: result.ignored === true,
      ignored_reason: result.ignored_reason,
      notifications_sent: result.notifications_sent === true,
      subscription_id: result.subscription_id,
      access_delivery: result.access_delivery,
    })
  );
}

export function GET(request: Request) {
  return handleIpn(request);
}

export function POST(request: Request) {
  return handleIpn(request);
}

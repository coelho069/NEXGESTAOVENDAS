import { NextResponse } from "next/server";
import { parseMercadoPagoCheckoutProWebhookNotification } from "@/lib/domain/mercadopago-checkout-pro";
import {
  getMercadoPagoEnv,
  isMercadoPagoCheckoutEnabled,
  verifyMercadoPagoWebhookRequest,
} from "@/lib/server/mercadopago";
import { applyMercadoPagoCheckoutProWebhookEvent } from "@/lib/server/mercadopago-checkout-pro-webhook";
import { clientRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";
import { rateLimitedResponse } from "@/lib/security/safe-error";
import {
  createRequestObservability,
  observeApiResult,
} from "@/lib/observability/request-context";

function dataIdFromRequest(request: Request): string | null {
  const url = new URL(request.url);
  return url.searchParams.get("data.id");
}

export async function POST(request: Request) {
  const obs = createRequestObservability(
    request,
    "subscriptions.mercadopago.public-checkout.webhook"
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
    key: clientRateLimitKey(request, "mercadopago-checkout-pro-webhook", "mercadopago"),
    limit: 120,
    windowMs: 60_000,
  });
  if (!rate.allowed) return obs.withHeaders(rateLimitedResponse(rate.retryAfterSec));

  const xSignature = request.headers.get("x-signature");
  if (!xSignature) {
    observeApiResult(obs, "rejected", { error: "mercadopago_webhook_unsigned" });
    return obs.withHeaders(
      NextResponse.json({ error: "mercadopago_webhook_unsigned" }, { status: 400 })
    );
  }

  const payload = await request.text();
  try {
    verifyMercadoPagoWebhookRequest({
      xSignature,
      xRequestId: request.headers.get("x-request-id"),
      dataId: dataIdFromRequest(request),
      secret: env.webhookSecret,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "mercadopago_webhook_invalid_signature";
    observeApiResult(obs, "rejected", { error: message });
    return obs.withHeaders(NextResponse.json({ error: message }, { status: 400 }));
  }

  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch {
    observeApiResult(obs, "rejected", { error: "mercadopago_webhook_invalid_body" });
    return obs.withHeaders(
      NextResponse.json({ error: "mercadopago_webhook_invalid_body" }, { status: 400 })
    );
  }

  const notification = parseMercadoPagoCheckoutProWebhookNotification(body);
  if (!notification) {
    observeApiResult(obs, "rejected", { error: "mercadopago_webhook_invalid_body" });
    return obs.withHeaders(
      NextResponse.json({ error: "mercadopago_webhook_invalid_body" }, { status: 400 })
    );
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

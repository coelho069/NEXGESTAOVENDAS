import { NextResponse } from "next/server";
import {
  getMercadoPagoAssinaturasEnv,
  isMercadoPagoAssinaturasCheckoutEnabled,
  verifyMercadoPagoAssinaturasWebhookRequest,
} from "@/lib/server/mercadopago-assinaturas";
import { applyMercadoPagoAssinaturasWebhookEvent } from "@/lib/server/mercadopago-assinaturas-webhook";
import {
  isMercadoPagoAssinaturasWebhookTypeAllowed,
  parseMercadoPagoAssinaturasWebhookNotification,
} from "@/lib/domain/mercadopago-assinaturas";
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
  const obs = createRequestObservability(request, "subscriptions.mercadopago.webhook");

  if (!isMercadoPagoAssinaturasCheckoutEnabled()) {
    observeApiResult(obs, "server_error", { error: "mercadopago_assinaturas_webhook_not_configured" });
    return obs.withHeaders(
      NextResponse.json({ error: "mercadopago_assinaturas_webhook_not_configured" }, { status: 503 })
    );
  }

  const env = getMercadoPagoAssinaturasEnv();
  if (!env.configured) {
    observeApiResult(obs, "server_error", { error: "mercadopago_assinaturas_webhook_not_configured" });
    return obs.withHeaders(
      NextResponse.json({ error: "mercadopago_assinaturas_webhook_not_configured" }, { status: 503 })
    );
  }

  const rate = consumeRateLimit({
    key: clientRateLimitKey(request, "mercadopago-assinaturas-webhook", "mercadopago-assinaturas"),
    limit: 120,
    windowMs: 60_000,
  });
  if (!rate.allowed) return obs.withHeaders(rateLimitedResponse(rate.retryAfterSec));

  const xSignature = request.headers.get("x-signature");
  if (!xSignature) {
    observeApiResult(obs, "rejected", { error: "mercadopago_assinaturas_webhook_unsigned" });
    return obs.withHeaders(
      NextResponse.json({ error: "mercadopago_assinaturas_webhook_unsigned" }, { status: 400 })
    );
  }

  const payload = await request.text();
  try {
    verifyMercadoPagoAssinaturasWebhookRequest({
      xSignature,
      xRequestId: request.headers.get("x-request-id"),
      dataId: dataIdFromRequest(request),
      secret: env.webhookSecret,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "mercadopago_assinaturas_webhook_invalid_signature";
    observeApiResult(obs, "rejected", { error: message });
    return obs.withHeaders(NextResponse.json({ error: message }, { status: 400 }));
  }

  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch {
    observeApiResult(obs, "rejected", { error: "mercadopago_assinaturas_webhook_invalid_body" });
    return obs.withHeaders(
      NextResponse.json({ error: "mercadopago_assinaturas_webhook_invalid_body" }, { status: 400 })
    );
  }

  const notification = parseMercadoPagoAssinaturasWebhookNotification(body);
  if (!notification) {
    observeApiResult(obs, "rejected", { error: "mercadopago_assinaturas_webhook_invalid_body" });
    return obs.withHeaders(
      NextResponse.json({ error: "mercadopago_assinaturas_webhook_invalid_body" }, { status: 400 })
    );
  }

  if (!isMercadoPagoAssinaturasWebhookTypeAllowed(notification.type)) {
    observeApiResult(obs, "ok", { ignored: true, type: notification.type });
    return obs.withHeaders(
      NextResponse.json({
        ok: true,
        ignored: true,
        event_id: notification.id,
        type: notification.type,
      })
    );
  }

  let result: Awaited<ReturnType<typeof applyMercadoPagoAssinaturasWebhookEvent>>;
  try {
    result = await applyMercadoPagoAssinaturasWebhookEvent(notification, {
      correlationId: obs.correlationId,
    });
  } catch {
    observeApiResult(obs, "server_error", {
      eventId: notification.id,
      type: notification.type,
      error: "mercadopago_assinaturas_webhook_processing_failed",
    });
    return obs.withHeaders(
      NextResponse.json(
        {
          error: "mercadopago_assinaturas_webhook_processing_failed",
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
      error: "mercadopago_assinaturas_webhook_retryable",
    });
    return obs.withHeaders(
      NextResponse.json(
        {
          error: "mercadopago_assinaturas_webhook_retryable",
          event_id: notification.id,
          type: notification.type,
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
    status: result.status,
    ignored: result.ignored === true,
  });

  return obs.withHeaders(
    NextResponse.json({
      ok: true,
      event_id: notification.id,
      type: notification.type,
      status: result.status,
      replay: result.replay === true,
      subscription_id: result.subscription_id,
      ignored: result.ignored === true,
    })
  );
}

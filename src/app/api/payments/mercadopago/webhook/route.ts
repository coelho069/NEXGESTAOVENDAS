import { NextResponse } from "next/server";
import {
  applyMercadoPagoWebhookNotification,
  getMercadoPagoEnv,
  isMercadoPagoCheckoutEnabled,
  parseMercadoPagoWebhookBody,
  verifyMercadoPagoWebhookRequest,
} from "@/lib/server/mercadopago";
import { isMercadoPagoWebhookEventAllowed } from "@/lib/domain/mercadopago";
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
  const obs = createRequestObservability(request, "payments.mercadopago.webhook");

  if (!isMercadoPagoCheckoutEnabled()) {
    observeApiResult(obs, "server_error", { error: "mercadopago_webhook_not_configured" });
    return obs.withHeaders(
      NextResponse.json({ error: "mercadopago_webhook_not_configured" }, { status: 503 })
    );
  }

  const env = getMercadoPagoEnv();
  if (!env.configured) {
    observeApiResult(obs, "server_error", { error: "mercadopago_webhook_not_configured" });
    return obs.withHeaders(
      NextResponse.json({ error: "mercadopago_webhook_not_configured" }, { status: 503 })
    );
  }

  const rate = consumeRateLimit({
    key: clientRateLimitKey(request, "mercadopago-webhook", "mercadopago"),
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
    const message = error instanceof Error ? error.message : "mercadopago_webhook_invalid_signature";
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

  const notification = parseMercadoPagoWebhookBody(body);
  if (!notification) {
    observeApiResult(obs, "rejected", { error: "mercadopago_webhook_invalid_body" });
    return obs.withHeaders(
      NextResponse.json({ error: "mercadopago_webhook_invalid_body" }, { status: 400 })
    );
  }

  if (!isMercadoPagoWebhookEventAllowed(notification.action)) {
    observeApiResult(obs, "ok", { ignored: true, action: notification.action });
    return obs.withHeaders(
      NextResponse.json({
        ok: true,
        ignored: true,
        event_id: notification.id,
        action: notification.action,
      })
    );
  }

  const result = applyMercadoPagoWebhookNotification(notification);
  observeApiResult(obs, "ok", {
    eventId: notification.id,
    action: notification.action,
    replay: result.replay === true,
    status: result.status,
  });

  return obs.withHeaders(
    NextResponse.json({
      ok: true,
      event_id: notification.id,
      action: notification.action,
      status: result.status,
      replay: result.replay === true,
      provider_reference: result.providerReference,
    })
  );
}

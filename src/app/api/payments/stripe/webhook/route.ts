import { NextResponse } from "next/server";
import { getStripeCardEnv, verifyStripeWebhookSignature } from "@/lib/server/stripe-card";
import { applyStripeWebhookEventBranched } from "@/lib/server/pix-payment";
import { isStripeWebhookEventAllowed } from "@/lib/domain/stripe-card";
import { clientRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";
import { rateLimitedResponse } from "@/lib/security/safe-error";
import {
  createRequestObservability,
  observeApiResult,
} from "@/lib/observability/request-context";

export async function POST(request: Request) {
  const obs = createRequestObservability(request, "payments.stripe.webhook");
  const env = getStripeCardEnv();
  if (!env.configured) {
    observeApiResult(obs, "server_error", { error: "stripe_webhook_not_configured" });
    return obs.withHeaders(
      NextResponse.json({ error: "stripe_webhook_not_configured" }, { status: 503 })
    );
  }

  const rate = consumeRateLimit({
    key: clientRateLimitKey(request, "stripe-webhook", "stripe"),
    limit: 120,
    windowMs: 60_000,
  });
  if (!rate.allowed) return obs.withHeaders(rateLimitedResponse(rate.retryAfterSec));

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    observeApiResult(obs, "rejected", { error: "stripe_webhook_unsigned" });
    return obs.withHeaders(NextResponse.json({ error: "stripe_webhook_unsigned" }, { status: 400 }));
  }

  const payload = await request.text();
  let event: { id: string; type: string; data: { object: Record<string, unknown> } };
  try {
    const verified = verifyStripeWebhookSignature({
      payload,
      signature,
      secret: env.webhookSecret,
    });
    event = {
      id: verified.id,
      type: verified.type,
      data: { object: verified.data.object as unknown as Record<string, unknown> },
    };
  } catch {
    observeApiResult(obs, "rejected", { error: "stripe_webhook_invalid_signature" });
    return obs.withHeaders(
      NextResponse.json({ error: "stripe_webhook_invalid_signature" }, { status: 400 })
    );
  }

  if (!isStripeWebhookEventAllowed(event.type)) {
    observeApiResult(obs, "ok", { ignored: true, type: event.type });
    return obs.withHeaders(
      NextResponse.json({ ok: true, ignored: true, event_id: event.id, type: event.type })
    );
  }

  const result = await applyStripeWebhookEventBranched(event);
  observeApiResult(obs, "ok", {
    eventId: event.id,
    type: event.type,
    replay: result.replay === true,
    status: result.status,
  });
  return obs.withHeaders(
    NextResponse.json({
      ok: true,
      event_id: event.id,
      type: event.type,
      status: result.status,
      replay: result.replay === true,
      provider_reference: result.providerReference,
      refund_status: result.refund_status,
    })
  );
}

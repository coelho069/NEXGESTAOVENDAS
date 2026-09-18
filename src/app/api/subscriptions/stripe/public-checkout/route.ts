import { NextResponse } from "next/server";
import { publicCheckoutInputSchema } from "@/lib/validation/schemas";
import { clientRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";
import { rateLimitedResponse, validationFailedResponse } from "@/lib/security/safe-error";
import {
  createRequestObservability,
  observeApiResult,
} from "@/lib/observability/request-context";
import { executeMercadoPagoIndependentStripeCheckout } from "@/lib/server/public-stripe-checkout";

export async function POST(request: Request) {
  const obs = createRequestObservability(request, "subscriptions.stripe.public-checkout");

  // Same abuse posture as the other public checkout rails.
  const rate = consumeRateLimit({
    key: clientRateLimitKey(request, "subscriptions-stripe-public-checkout"),
    limit: 10,
    windowMs: 60_000,
  });
  if (!rate.allowed) return obs.withHeaders(rateLimitedResponse(rate.retryAfterSec));

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return obs.withHeaders(NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }));
  }

  const parsed = publicCheckoutInputSchema.safeParse(json);
  if (!parsed.success) {
    return obs.withHeaders(
      validationFailedResponse(process.env.NODE_ENV === "production", parsed.error.flatten())
    );
  }

  const emailRate = consumeRateLimit({
    key: `subscriptions-stripe-public-checkout:email:${parsed.data.payer_email.toLowerCase()}`,
    limit: 5,
    windowMs: 3_600_000,
  });
  if (!emailRate.allowed) return obs.withHeaders(rateLimitedResponse(emailRate.retryAfterSec));

  const clientMutationId = parsed.data.client_mutation_id ?? crypto.randomUUID();
  const result = await executeMercadoPagoIndependentStripeCheckout({
    planId: parsed.data.plan_id,
    payerEmail: parsed.data.payer_email,
    clientMutationId,
    correlationId: obs.correlationId,
  });

  if (!result.ok) {
    observeApiResult(obs, "rejected", { error: result.error });
    return obs.withHeaders(NextResponse.json({ error: result.error }, { status: result.status }));
  }

  observeApiResult(obs, "ok", {
    checkout_session_id: result.checkout_session_id,
    replayed: result.replayed,
  });

  return obs.withHeaders(
    NextResponse.json({
      ok: true,
      provider: "stripe",
      checkout_url: result.checkout_url,
      checkout_session_id: result.checkout_session_id,
      client_mutation_id: result.client_mutation_id,
      replayed: result.replayed,
    })
  );
}

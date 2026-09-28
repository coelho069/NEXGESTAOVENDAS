import { NextResponse } from "next/server";
import {
  paymentScreenResponseFor,
  resolvePaymentScreenSnapshot,
} from "@/lib/server/payment-screen-status";
import { clientRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";
import { rateLimitedResponse } from "@/lib/security/safe-error";
import {
  createRequestObservability,
  observeApiResult,
} from "@/lib/observability/request-context";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/subscriptions/mercadopago/public-checkout/status
 *
 * Public (no auth), read-only status lookup for the /pagamento/* screens.
 * Accepts the query params MP appends to the back_urls: payment_id,
 * collection_id (aliased to payment_id), external_reference, preference_id.
 * Never exposes tokens, never fulfills a payment — the MP webhook remains the
 * source of truth; this only mirrors what is already persisted.
 */
export async function GET(request: Request) {
  const obs = createRequestObservability(
    request,
    "subscriptions.mercadopago.public-checkout.status"
  );

  const rate = consumeRateLimit({
    key: clientRateLimitKey(request, "mercadopago-public-checkout-status"),
    limit: 30,
    windowMs: 60_000,
  });
  if (!rate.allowed) return obs.withHeaders(rateLimitedResponse(rate.retryAfterSec));

  const url = new URL(request.url);
  const paymentId = url.searchParams.get("payment_id") ?? url.searchParams.get("collection_id");
  const externalReference = url.searchParams.get("external_reference");
  const preferenceId = url.searchParams.get("preference_id");

  if (!paymentId?.trim() && !externalReference?.trim() && !preferenceId?.trim()) {
    return obs.withHeaders(
      NextResponse.json(
        { outcome: "unknown", error: "missing_payment_reference" },
        { status: 400 }
      )
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    return obs.withHeaders(
      NextResponse.json({ outcome: "unknown", error: "service_role_unavailable" }, { status: 503 })
    );
  }

  try {
    const resolution = await resolvePaymentScreenSnapshot({
      admin,
      externalReference,
      paymentId,
      preferenceId,
    });

    if (!resolution.ok && resolution.reason === "database") {
      observeApiResult(obs, "server_error", { error: "status_lookup_failed" });
      return obs.withHeaders(
        NextResponse.json({ outcome: "unknown", error: "status_lookup_failed" }, { status: 503 })
      );
    }

    observeApiResult(obs, resolution.ok ? "ok" : "rejected", {
      matched: resolution.ok ? resolution.snapshot.matched_by : null,
      outcome: resolution.ok ? resolution.snapshot.outcome : "not_found",
    });

    return obs.withHeaders(NextResponse.json(paymentScreenResponseFor(resolution)));
  } catch {
    observeApiResult(obs, "server_error", { error: "status_lookup_failed" });
    return obs.withHeaders(
      NextResponse.json({ outcome: "unknown", error: "status_lookup_failed" }, { status: 503 })
    );
  }
}

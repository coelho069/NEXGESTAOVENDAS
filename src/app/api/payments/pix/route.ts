import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import { pixPaymentInputSchema, storeIdSchema } from "@/lib/validation/schemas";
import { clientRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";
import { rateLimitedResponse, validationFailedResponse } from "@/lib/security/safe-error";
import { executePixPayment, getPixAdapterHealth } from "@/lib/server/pix-payment";
import {
  createRequestObservability,
  observeApiResult,
} from "@/lib/observability/request-context";

export async function GET(request: Request) {
  const obs = createRequestObservability(request, "payments.pix.health");
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return obs.withHeaders(NextResponse.json({ error: "auth_not_configured" }, { status: 503 }));
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return obs.withHeaders(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const health = await getPixAdapterHealth();
  observeApiResult(obs, "ok", { configured: health.configured });
  return obs.withHeaders(
    NextResponse.json({
      configured: health.configured,
      testmode: health.testmode,
      method: "pix",
      reason: health.reason,
      message: health.configured
        ? health.message
        : health.reason === "pix_checkout_hold"
          ? health.message
          : "Adapter PIX não configurado.",
    })
  );
}

export async function POST(request: Request) {
  const obs = createRequestObservability(request, "payments.pix");
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    observeApiResult(obs, "server_error", { error: "auth_not_configured" });
    return obs.withHeaders(NextResponse.json({ error: "auth_not_configured" }, { status: 503 }));
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    observeApiResult(obs, "rejected", { error: "Unauthorized" });
    return obs.withHeaders(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const rate = consumeRateLimit({
    key: clientRateLimitKey(request, "payments-pix", user.id),
    limit: 30,
    windowMs: 60_000,
  });
  if (!rate.allowed) return obs.withHeaders(rateLimitedResponse(rate.retryAfterSec));

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return obs.withHeaders(NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }));
  }

  const requestedStoreId =
    json && typeof json === "object" && "store_id" in json
      ? (json as { store_id?: unknown }).store_id
      : undefined;
  const storeIdResult = storeIdSchema.safeParse(requestedStoreId);
  if (!storeIdResult.success) {
    return obs.withHeaders(NextResponse.json({ error: "forbidden_store" }, { status: 403 }));
  }

  const parsed = pixPaymentInputSchema.safeParse(json);
  if (!parsed.success) {
    return obs.withHeaders(
      validationFailedResponse(process.env.NODE_ENV === "production", parsed.error.flatten())
    );
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.orgId || !auth.role) {
    return obs.withHeaders(NextResponse.json({ error: "forbidden_store" }, { status: 403 }));
  }

  const result = await executePixPayment(supabase, parsed.data, user.id);
  observeApiResult(obs, "ok", {
    status: result.status,
    action: parsed.data.action,
    saleConfirmed: result.sale_confirmed === true,
  });
  return obs.withHeaders(
    NextResponse.json({
      status: result.status,
      message: result.message,
      configured: result.configured,
      provider_reference: result.providerReference,
      sale_id: result.sale_id,
      sale_status: result.sale_status,
      sale_confirmed: result.sale_confirmed === true,
      qr: result.qr ?? null,
    })
  );
}

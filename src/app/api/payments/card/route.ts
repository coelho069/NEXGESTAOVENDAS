import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import { cardPaymentInputSchema, storeIdSchema } from "@/lib/validation/schemas";
import { clientRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";
import { rateLimitedResponse, validationFailedResponse } from "@/lib/security/safe-error";
import { executeCardPayment, getCardAdapterHealth } from "@/lib/server/card-payment";
import { loadStoreSalePolicy } from "@/lib/server/store-sale-policy";
import {
  createRequestObservability,
  observeApiResult,
} from "@/lib/observability/request-context";

export async function GET(request: Request) {
  const obs = createRequestObservability(request, "payments.card.health");
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

  const health = await getCardAdapterHealth();
  observeApiResult(obs, "ok", { configured: health.configured });
  return obs.withHeaders(
    NextResponse.json({
      configured: health.configured,
      testmode: health.testmode,
      method: "card",
      message: health.configured
        ? health.message
        : "Adapter card não configurado.",
    })
  );
}

export async function POST(request: Request) {
  const obs = createRequestObservability(request, "payments.card");
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
    key: clientRateLimitKey(request, "payments-card", user.id),
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

  const parsed = cardPaymentInputSchema.safeParse(json);
  if (!parsed.success) {
    return obs.withHeaders(
      validationFailedResponse(process.env.NODE_ENV === "production", parsed.error.flatten())
    );
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.orgId || !auth.role) {
    return obs.withHeaders(NextResponse.json({ error: "forbidden_store" }, { status: 403 }));
  }

  const salePolicy = await loadStoreSalePolicy(supabase, parsed.data.store_id);
  if (salePolicy.requireCustomerOnSale && !parsed.data.customer_id) {
    observeApiResult(obs, "client_error", {
      error: "customer_required_on_sale",
      action: parsed.data.action,
      saleConfirmed: false,
    });
    return obs.withHeaders(
      NextResponse.json(
        {
          error: "customer_required_on_sale",
          status: "unknown",
          sale_confirmed: false,
          configured: true,
          message: "Selecione um cliente para concluir a venda.",
        },
        { status: 422 }
      )
    );
  }

  const result = await executeCardPayment(supabase, parsed.data, user.id);
  const saleConfirmed = result.sale_confirmed === true;
  const status = result.status === "captured" && !saleConfirmed ? "unknown" : result.status;
  const captureError =
    parsed.data.action === "capture" && !saleConfirmed
      ? result.error ?? "card_capture_without_sale"
      : undefined;
  const outcome =
    result.status === "not_configured"
      ? "rejected"
      : parsed.data.action === "capture" && !saleConfirmed
        ? "client_error"
        : "ok";
  observeApiResult(obs, outcome, {
    status,
    action: parsed.data.action,
    saleConfirmed,
    ...(captureError ? { error: captureError } : {}),
  });
  return obs.withHeaders(
    NextResponse.json({
      status,
      error: captureError,
      message: result.message,
      configured: result.configured,
      provider_reference: result.providerReference,
      sale_id: result.sale_id,
      sale_status: result.sale_status,
      sale_confirmed: saleConfirmed,
    })
  );
}

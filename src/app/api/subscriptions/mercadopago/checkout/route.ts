import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import { mercadoPagoAssinaturasCheckoutInputSchema } from "@/lib/validation/schemas";
import { clientRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";
import { rateLimitedResponse, validationFailedResponse } from "@/lib/security/safe-error";
import {
  createRequestObservability,
  observeApiResult,
} from "@/lib/observability/request-context";
import {
  executeMercadoPagoAssinaturasCheckout,
  getMercadoPagoAssinaturasCheckoutHealth,
} from "@/lib/server/mercadopago-assinaturas-checkout";

export async function GET(request: Request) {
  const obs = createRequestObservability(request, "subscriptions.mercadopago.checkout.health");
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

  const health = await getMercadoPagoAssinaturasCheckoutHealth();
  observeApiResult(obs, "ok", { configured: health.configured });
  return obs.withHeaders(
    NextResponse.json({
      configured: health.configured,
      testmode: health.testmode,
      provider: "mercadopago_assinaturas",
      reason: health.reason,
      message: health.message,
    })
  );
}

export async function POST(request: Request) {
  const obs = createRequestObservability(request, "subscriptions.mercadopago.checkout");
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
    key: clientRateLimitKey(request, "subscriptions-mercadopago-checkout", user.id),
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

  const parsed = mercadoPagoAssinaturasCheckoutInputSchema.safeParse(json);
  if (!parsed.success) {
    return obs.withHeaders(
      validationFailedResponse(process.env.NODE_ENV === "production", parsed.error.flatten())
    );
  }

  const auth = await getAuthedContext();
  if (!auth?.orgId) {
    observeApiResult(obs, "rejected", { error: "forbidden_org" });
    return obs.withHeaders(NextResponse.json({ error: "forbidden_org" }, { status: 403 }));
  }

  const clientMutationId = parsed.data.client_mutation_id ?? crypto.randomUUID();
  const result = await executeMercadoPagoAssinaturasCheckout({
    supabase,
    orgId: auth.orgId,
    userId: auth.userId,
    planId: parsed.data.plan_id,
    clientMutationId,
  });

  if (!result.ok) {
    observeApiResult(obs, "rejected", { error: result.error });
    return obs.withHeaders(NextResponse.json({ error: result.error }, { status: result.status }));
  }

  observeApiResult(obs, "ok", {
    preapproval_plan_id: result.preapproval_plan_id,
    subscription_id: result.subscription_id,
  });

  return obs.withHeaders(
    NextResponse.json({
      ok: true,
      init_point: result.init_point,
      preapproval_plan_id: result.preapproval_plan_id,
      subscription_id: result.subscription_id,
      client_mutation_id: result.client_mutation_id,
    })
  );
}

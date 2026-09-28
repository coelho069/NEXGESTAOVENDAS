import { NextResponse } from "next/server";
import { publicCheckoutInputSchema } from "@/lib/validation/schemas";
import { clientRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";
import { rateLimitedResponse, validationFailedResponse } from "@/lib/security/safe-error";
import {
  createRequestObservability,
  observeApiResult,
} from "@/lib/observability/request-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { executeCheckoutProPreference } from "@/lib/server/mercadopago-checkout-pro";

function asAmountString(value: number | string): string {
  return typeof value === "number" ? value.toFixed(2) : value;
}

export async function POST(request: Request) {
  const obs = createRequestObservability(request, "subscriptions.mercadopago.public-checkout");

  const rate = consumeRateLimit({
    key: clientRateLimitKey(request, "subscriptions-mercadopago-public-checkout"),
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
    key: `subscriptions-mercadopago-public-checkout:email:${parsed.data.payer_email.toLowerCase()}`,
    limit: 5,
    windowMs: 3_600_000,
  });
  if (!emailRate.allowed) return obs.withHeaders(rateLimitedResponse(emailRate.retryAfterSec));

  const admin = createAdminClient();
  if (!admin) {
    return obs.withHeaders(NextResponse.json({ error: "service_role_unavailable" }, { status: 503 }));
  }

  const { data: plan, error: planError } = await admin
    .from("plans")
    .select("id, name, amount, currency, is_active")
    .eq("id", parsed.data.plan_id)
    .maybeSingle();

  if (planError || !plan) {
    return obs.withHeaders(NextResponse.json({ error: "plan_not_found" }, { status: 404 }));
  }
  if (!plan.is_active) {
    return obs.withHeaders(NextResponse.json({ error: "plan_inactive" }, { status: 400 }));
  }
  if (plan.currency !== "BRL") {
    return obs.withHeaders(NextResponse.json({ error: "plan_currency_unsupported" }, { status: 400 }));
  }

  const clientMutationId = parsed.data.client_mutation_id ?? crypto.randomUUID();
  const result = await executeCheckoutProPreference({
    planId: plan.id,
    planName: plan.name,
    amount: asAmountString(plan.amount),
    payerEmail: parsed.data.payer_email,
    clientMutationId,
    correlationId: obs.correlationId,
  });

  if (!result.ok) {
    observeApiResult(obs, "rejected", { error: result.error });
    return obs.withHeaders(NextResponse.json({ error: result.error }, { status: result.status }));
  }

  observeApiResult(obs, "ok", {
    preference_id: result.preference_id,
    replayed: result.replayed,
  });

  return obs.withHeaders(
    NextResponse.json({
      ok: true,
      provider: "mercadopago",
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point,
      preference_id: result.preference_id,
      client_mutation_id: result.client_mutation_id,
      replayed: result.replayed,
    })
  );
}

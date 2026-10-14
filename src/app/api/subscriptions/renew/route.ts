import { NextResponse } from "next/server";
import { clientRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";
import { rateLimitedResponse } from "@/lib/security/safe-error";
import { createRequestObservability, observeApiResult } from "@/lib/observability/request-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { executeCheckoutProPreference } from "@/lib/server/mercadopago-checkout-pro";

/**
 * Renovação para cliente logado: Checkout Pro ancorado na org do próprio
 * usuário. O webhook estende a mesma assinatura (nada de org nova).
 */
export async function POST(request: Request) {
  const obs = createRequestObservability(request, "subscriptions.renew");
  const rate = consumeRateLimit({
    key: clientRateLimitKey(request, "subscriptions-renew"),
    limit: 5,
    windowMs: 60_000,
  });
  if (!rate.allowed) return obs.withHeaders(rateLimitedResponse(rate.retryAfterSec));

  const reject = (error: string, status: number) => {
    observeApiResult(obs, "rejected", { error });
    return obs.withHeaders(NextResponse.json({ error }, { status }));
  };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id || !user.email) return reject("unauthorized", 401);

  const admin = createAdminClient();
  if (!admin) return reject("service_role_unavailable", 503);

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) return reject("renew_profile_lookup_failed", 503);
  const orgId = profile?.org_id ?? null;
  if (!orgId) return reject("renew_no_organization", 409);

  const { data: latest, error: latestError } = await admin
    .from("subscriptions")
    .select("plan_id")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) return reject("renew_subscription_lookup_failed", 503);
  if (!latest) return reject("renew_no_subscription", 409);

  const { data: plan, error: planError } = await admin
    .from("plans")
    .select("id, name, amount, currency, is_active")
    .eq("id", latest.plan_id)
    .maybeSingle();
  if (planError) return reject("renew_plan_lookup_failed", 503);
  if (!plan || !plan.is_active) return reject("plan_inactive", 409);
  if (plan.currency !== "BRL") return reject("plan_currency_unsupported", 400);

  const result = await executeCheckoutProPreference({
    planId: plan.id,
    planName: plan.name,
    amount: typeof plan.amount === "number" ? plan.amount.toFixed(2) : String(plan.amount),
    payerEmail: user.email.trim().toLowerCase(),
    clientMutationId: crypto.randomUUID(),
    correlationId: obs.correlationId,
    renewal: { userId: user.id, orgId },
  });
  if (!result.ok) return reject(result.error, result.status);

  observeApiResult(obs, "ok", { preference_id: result.preference_id });
  return obs.withHeaders(NextResponse.json({ ok: true, init_point: result.init_point }));
}

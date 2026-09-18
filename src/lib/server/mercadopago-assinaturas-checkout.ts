import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  addBillingPeriodStart,
  buildAssinaturasExternalReference,
  formatDateOnlyUtc,
} from "@/lib/domain/mercadopago-assinaturas";
import type { SubscriptionBillingInterval } from "@/lib/domain/admin-subscriptions";
import {
  createMercadoPagoAssinaturasGateway,
  getMercadoPagoAssinaturasEnv,
  isMercadoPagoAssinaturasCheckoutEnabled,
  mercadoPagoAssinaturasCheckoutHoldHealth,
  resolveAssinaturasBackUrl,
  resolveMercadoPagoAssinaturasPayerEmail,
} from "@/lib/server/mercadopago-assinaturas";

type DbClient = SupabaseClient<Database>;

export type MercadoPagoAssinaturasCheckoutResult =
  | {
      ok: true;
      init_point: string;
      preapproval_id: string;
      subscription_id: string;
      client_mutation_id: string;
    }
  | {
      ok: false;
      error: string;
      status: number;
    };

type PlanRow = {
  id: string;
  name: string;
  amount: number | string;
  currency: string;
  billing_interval: string;
  is_active: boolean;
  mp_preapproval_plan_id: string | null;
};

function asAmountString(value: number | string): string {
  return typeof value === "number" ? value.toFixed(2) : value;
}

export async function getMercadoPagoAssinaturasCheckoutHealth(): Promise<{
  configured: boolean;
  testmode: boolean;
  message: string;
  reason?: string;
}> {
  if (!isMercadoPagoAssinaturasCheckoutEnabled()) {
    return mercadoPagoAssinaturasCheckoutHoldHealth();
  }
  const env = getMercadoPagoAssinaturasEnv();
  if (!env.configured) {
    return {
      configured: false,
      testmode: false,
      message: "Mercado Pago Assinaturas não configurado.",
      reason: env.reason,
    };
  }
  const gateway = createMercadoPagoAssinaturasGateway(env);
  const health = await gateway.health();
  return {
    configured: health.ok,
    testmode: health.testmode,
    message: health.message,
    reason: health.ok ? undefined : "mercadopago_assinaturas_health_failed",
  };
}

async function ensureMercadoPagoPreapprovalPlan(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  plan: PlanRow,
  backUrl: string
): Promise<string> {
  if (plan.mp_preapproval_plan_id) {
    return plan.mp_preapproval_plan_id;
  }

  const env = getMercadoPagoAssinaturasEnv();
  if (!env.configured) {
    throw new Error("mercadopago_assinaturas_not_configured");
  }

  const gateway = createMercadoPagoAssinaturasGateway(env);
  const snapshot = await gateway.createPreapprovalPlan({
    reason: plan.name,
    amount: asAmountString(plan.amount),
    billingInterval: plan.billing_interval as SubscriptionBillingInterval,
    backUrl,
  });

  const { error } = await admin
    .from("plans")
    .update({ mp_preapproval_plan_id: snapshot.id })
    .eq("id", plan.id);

  if (error) {
    throw new Error("mercadopago_assinaturas_plan_persist_failed");
  }

  return snapshot.id;
}

export async function executeMercadoPagoAssinaturasCheckout(input: {
  supabase: DbClient;
  orgId: string;
  userId: string;
  planId: string;
  clientMutationId: string;
}): Promise<MercadoPagoAssinaturasCheckoutResult> {
  if (!isMercadoPagoAssinaturasCheckoutEnabled()) {
    return {
      ok: false,
      error: "mercadopago_assinaturas_checkout_hold",
      status: 503,
    };
  }

  const env = getMercadoPagoAssinaturasEnv();
  if (!env.configured) {
    return { ok: false, error: "mercadopago_assinaturas_not_configured", status: 503 };
  }

  const admin = createAdminClient();
  if (!admin) {
    return { ok: false, error: "service_role_unavailable", status: 503 };
  }

  const { data: openSubscription, error: openError } = await input.supabase
    .from("subscriptions")
    .select("id, status")
    .eq("org_id", input.orgId)
    .in("status", ["active", "trialing", "past_due"])
    .maybeSingle();

  if (openError) {
    return { ok: false, error: "subscription_lookup_failed", status: 503 };
  }
  if (openSubscription) {
    return { ok: false, error: "open_subscription_exists", status: 409 };
  }

  const { data: plan, error: planError } = await input.supabase
    .from("plans")
    .select("id, name, amount, currency, billing_interval, is_active, mp_preapproval_plan_id")
    .eq("id", input.planId)
    .maybeSingle();

  if (planError || !plan) {
    return { ok: false, error: "plan_not_found", status: 404 };
  }
  if (!plan.is_active) {
    return { ok: false, error: "plan_inactive", status: 400 };
  }

  const backUrl = resolveAssinaturasBackUrl();
  let preapprovalPlanId: string;
  try {
    preapprovalPlanId = await ensureMercadoPagoPreapprovalPlan(admin, plan as PlanRow, backUrl);
  } catch {
    return { ok: false, error: "mercadopago_assinaturas_plan_failed", status: 502 };
  }

  const payerEmail = resolveMercadoPagoAssinaturasPayerEmail();
  const externalReference = buildAssinaturasExternalReference(input.orgId, input.clientMutationId);
  const gateway = createMercadoPagoAssinaturasGateway(env);

  let preapproval;
  try {
    preapproval = await gateway.createPreapproval({
      preapprovalPlanId,
      reason: plan.name,
      externalReference,
      payerEmail,
      backUrl,
      clientMutationId: input.clientMutationId,
    });
  } catch {
    return { ok: false, error: "mercadopago_assinaturas_preapproval_failed", status: 502 };
  }

  const initPoint = preapproval.sandboxInitPoint ?? preapproval.initPoint;
  if (!initPoint) {
    return { ok: false, error: "mercadopago_assinaturas_missing_init_point", status: 502 };
  }

  const periodStart = new Date();
  const periodEnd = addBillingPeriodStart(
    periodStart,
    plan.billing_interval as SubscriptionBillingInterval
  );

  const { data: subscription, error: insertError } = await admin
    .from("subscriptions")
    .insert({
      org_id: input.orgId,
      plan_id: plan.id,
      status: "trialing",
      contracted_amount: Number(asAmountString(plan.amount)),
      currency: plan.currency,
      period_start: formatDateOnlyUtc(periodStart),
      period_end: formatDateOnlyUtc(periodEnd),
      mp_preapproval_id: preapproval.id,
      checkout_client_mutation_id: input.clientMutationId,
      mp_payer_email: payerEmail,
    })
    .select("id")
    .single();

  if (insertError || !subscription) {
    return { ok: false, error: "subscription_insert_failed", status: 503 };
  }

  return {
    ok: true,
    init_point: initPoint,
    preapproval_id: preapproval.id,
    subscription_id: subscription.id,
    client_mutation_id: input.clientMutationId,
  };
}

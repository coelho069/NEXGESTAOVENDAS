import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  addBillingPeriodStart,
  formatDateOnlyUtc,
  type MercadoPagoPreapprovalPlanSnapshot,
} from "@/lib/domain/mercadopago-assinaturas";
import type { SubscriptionBillingInterval } from "@/lib/domain/admin-subscriptions";
import {
  createMercadoPagoAssinaturasGateway,
  getMercadoPagoAssinaturasEnv,
  isMercadoPagoAssinaturasCheckoutEnabled,
  mercadoPagoAssinaturasCheckoutHoldHealth,
  resolveAssinaturasBackUrl,
} from "@/lib/server/mercadopago-assinaturas";

type DbClient = SupabaseClient<Database>;

export type MercadoPagoAssinaturasCheckoutResult =
  | {
      ok: true;
      /** Hosted checkout URL do Mercado Pago (init_point do preapproval_plan). O MP coleta o pagamento. */
      init_point: string;
      /** mp_preapproval_plan_id do plano no Mercado Pago. */
      preapproval_plan_id: string;
      /** Assinatura local pendente, criada agora para o webhook casar o evento do MP. */
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
): Promise<MercadoPagoPreapprovalPlanSnapshot> {
  const env = getMercadoPagoAssinaturasEnv();
  if (!env.configured) {
    throw new Error("mercadopago_assinaturas_not_configured");
  }

  const gateway = createMercadoPagoAssinaturasGateway(env);

  // Plano já vinculado no banco: apenas buscar o snapshot atual (com init_point) no MP.
  if (plan.mp_preapproval_plan_id) {
    const existing = await gateway.getPreapprovalPlan(plan.mp_preapproval_plan_id);
    if (existing) return existing;
    // Plano sumiu do MP (removido manualmente): recriar e atualizar o vínculo abaixo.
  }

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

  return snapshot;
}

export type MercadoPagoAssinaturasPlanResolution = {
  snapshot: MercadoPagoPreapprovalPlanSnapshot;
};

/**
 * Resolves (or creates) the MP preapproval_plan for a plan row and returns its
 * snapshot with init_point. Shared by the authenticated checkout and the
 * public visitor checkout.
 */
export async function executeMercadoPagoAssinaturasPlanResolution(input: {
  admin: NonNullable<ReturnType<typeof createAdminClient>>;
  plan: PlanRow;
  backUrl: string;
}): Promise<MercadoPagoAssinaturasPlanResolution> {
  const snapshot = await ensureMercadoPagoPreapprovalPlan(input.admin, input.plan, input.backUrl);
  return { snapshot };
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
  let planSnapshot: MercadoPagoPreapprovalPlanSnapshot;
  try {
    planSnapshot = await ensureMercadoPagoPreapprovalPlan(admin, plan as PlanRow, backUrl);
  } catch {
    return { ok: false, error: "mercadopago_assinaturas_plan_failed", status: 502 };
  }

  // Hosted checkout: o Mercado Pago coleta os dados de pagamento do assinante na URL init_point
  // do preapproval_plan e cria o preapproval lá. Sem card_token_id (API pura rejeita com 400).
  const initPoint = planSnapshot.initPoint;
  if (!initPoint) {
    return { ok: false, error: "mercadopago_assinaturas_missing_init_point", status: 502 };
  }

  // Assinatura local pendente: ancora o webhook (RPC casa por org_id + checkout_client_mutation_id
  // e anexa o mp_preapproval_id real do evento do MP). Status efetivo só após confirmação do MP.
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
      checkout_client_mutation_id: input.clientMutationId,
    })
    .select("id")
    .single();

  if (insertError || !subscription) {
    return { ok: false, error: "subscription_insert_failed", status: 503 };
  }

  return {
    ok: true,
    init_point: initPoint,
    preapproval_plan_id: planSnapshot.id,
    subscription_id: subscription.id,
    client_mutation_id: input.clientMutationId,
  };
}

import type { Json } from "@/lib/db/types";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  addBillingPeriodStart,
  formatDateOnlyUtc,
  mapMercadoPagoPreapprovalStatusToSubscriptionStatus,
  parseAssinaturasExternalReference,
  type MercadoPagoAssinaturasWebhookNotification,
} from "@/lib/domain/mercadopago-assinaturas";
import type { SubscriptionBillingInterval } from "@/lib/domain/admin-subscriptions";
import {
  createMercadoPagoAssinaturasGateway,
  getMercadoPagoAssinaturasEnv,
} from "@/lib/server/mercadopago-assinaturas";

function asJson(value: unknown): Json {
  return value as Json;
}

export type MercadoPagoAssinaturasWebhookApplyResult = {
  replay: boolean;
  event_id: string;
  subscription_id?: string;
  status?: string;
  ignored?: boolean;
};

export async function applyMercadoPagoAssinaturasWebhookEvent(
  notification: MercadoPagoAssinaturasWebhookNotification
): Promise<MercadoPagoAssinaturasWebhookApplyResult> {
  const preapprovalId = notification.data.id?.trim();
  if (!preapprovalId) {
    return {
      replay: false,
      event_id: String(notification.id),
      ignored: true,
    };
  }

  const env = getMercadoPagoAssinaturasEnv();
  if (!env.configured) {
    throw new Error("mercadopago_assinaturas_not_configured");
  }

  const admin = createAdminClient();
  if (!admin) {
    throw new Error("service_role_unavailable");
  }

  const gateway = createMercadoPagoAssinaturasGateway(env);
  const preapproval = await gateway.getPreapproval(preapprovalId);
  if (!preapproval) {
    return {
      replay: false,
      event_id: String(notification.id),
      ignored: true,
    };
  }

  const external = parseAssinaturasExternalReference(preapproval.externalReference);
  if (!external) {
    return {
      replay: false,
      event_id: String(notification.id),
      ignored: true,
    };
  }

  const { data: subscriptionRow, error: subscriptionError } = await admin
    .from("subscriptions")
    .select("id, plan_id")
    .eq("org_id", external.orgId)
    .eq("checkout_client_mutation_id", external.clientMutationId)
    .maybeSingle();

  if (subscriptionError) {
    throw new Error("subscription_lookup_failed");
  }

  let billingInterval: SubscriptionBillingInterval = "monthly";
  if (subscriptionRow?.plan_id) {
    const { data: planRow } = await admin
      .from("plans")
      .select("billing_interval")
      .eq("id", subscriptionRow.plan_id)
      .maybeSingle();
    if (planRow?.billing_interval === "yearly" || planRow?.billing_interval === "monthly") {
      billingInterval = planRow.billing_interval;
    }
  }

  const mappedStatus = mapMercadoPagoPreapprovalStatusToSubscriptionStatus(preapproval.status);
  const dbStatus =
    mappedStatus === "canceled" ? ("cancelled" as const) : mappedStatus;

  const periodStart = new Date();
  const periodEnd = addBillingPeriodStart(periodStart, billingInterval);

  if (notification.type === "subscription_authorized_payment" && mappedStatus === "active") {
    // Extend billing period on successful charge notification.
    const extendedEnd = addBillingPeriodStart(periodStart, billingInterval);
    periodEnd.setTime(extendedEnd.getTime());
  }

  const { data, error } = await admin.rpc("apply_subscription_mercadopago_event", {
    p_event_id: String(notification.id),
    p_event_type: notification.type,
    p_provider_ref: preapprovalId,
    p_org_id: external.orgId,
    p_subscription_status: dbStatus,
    p_period_start: formatDateOnlyUtc(periodStart),
    p_period_end: formatDateOnlyUtc(periodEnd),
    p_payload: asJson({
      action: notification.action,
      preapproval_status: preapproval.status,
      external_reference: preapproval.externalReference,
    }),
  });

  if (error) {
    if (error.message?.includes("subscription_not_found") || error.code === "P0002") {
      return {
        replay: false,
        event_id: String(notification.id),
        ignored: true,
      };
    }
    throw new Error(error.message ?? "apply_subscription_mercadopago_event_failed");
  }

  const payload = (data ?? {}) as {
    replay?: boolean;
    subscription_id?: string;
    status?: string;
  };

  return {
    replay: payload.replay === true,
    event_id: String(notification.id),
    subscription_id: payload.subscription_id,
    status: payload.status,
  };
}

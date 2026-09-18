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
import { parseCheckoutSessionExternalReference } from "@/lib/domain/onboarding-visitor";
import {
  createMercadoPagoAssinaturasGateway,
  getMercadoPagoAssinaturasEnv,
} from "@/lib/server/mercadopago-assinaturas";
import { resolvePublicCheckoutSession } from "@/lib/server/public-checkout-sessions";
import { runVisitorOnboarding } from "@/lib/server/visitor-onboarding";

function asJson(value: unknown): Json {
  return value as Json;
}

export type MercadoPagoAssinaturasWebhookApplyResult = {
  replay: boolean;
  event_id: string;
  subscription_id?: string;
  status?: string;
  ignored?: boolean;
  ignored_reason?: string;
  retryable?: boolean;
};

async function retrievePreapprovalForNotification(input: {
  gateway: ReturnType<typeof createMercadoPagoAssinaturasGateway>;
  notification: MercadoPagoAssinaturasWebhookNotification;
}): Promise<{
  preapproval: Awaited<ReturnType<ReturnType<typeof createMercadoPagoAssinaturasGateway>["getPreapproval"]>>;
  ignoredReason?: string;
}> {
  const dataId = input.notification.data.id?.trim();
  if (!dataId) return { preapproval: null, ignoredReason: "preapproval_id_missing" };

  if (input.notification.type === "subscription_authorized_payment") {
    const authorizedPayment = await input.gateway.getAuthorizedPayment(dataId);
    if (!authorizedPayment?.preapprovalId) {
      return { preapproval: null, ignoredReason: "authorized_payment_preapproval_missing" };
    }
    if (
      (authorizedPayment.status &&
        authorizedPayment.status.trim().toLowerCase() !== "processed") ||
      (authorizedPayment.paymentStatus &&
        !["approved", "authorized"].includes(
          authorizedPayment.paymentStatus.trim().toLowerCase()
        ))
    ) {
      return { preapproval: null, ignoredReason: "authorized_payment_not_processed" };
    }
    return { preapproval: await input.gateway.getPreapproval(authorizedPayment.preapprovalId) };
  }

  return { preapproval: await input.gateway.getPreapproval(dataId) };
}

export async function applyMercadoPagoAssinaturasWebhookEvent(
  notification: MercadoPagoAssinaturasWebhookNotification,
  options: { correlationId?: string } = {}
): Promise<MercadoPagoAssinaturasWebhookApplyResult> {
  const dataId = notification.data.id?.trim();
  if (!dataId) {
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
  const retrieved = await retrievePreapprovalForNotification({ gateway, notification });
  const preapproval = retrieved.preapproval;
  if (!preapproval) {
    return {
      replay: false,
      event_id: String(notification.id),
      ignored: true,
      ignored_reason: retrieved.ignoredReason ?? "preapproval_not_found",
    };
  }
  const preapprovalId = preapproval.id;

  // Confirm the current provider state after retrieving the resource. A
  // notification itself is only a hint and never authorizes onboarding.
  const checkoutSession = parseCheckoutSessionExternalReference(preapproval.externalReference);
  const legacyExternal = parseAssinaturasExternalReference(preapproval.externalReference);
  const confirmed = preapproval.status.trim().toLowerCase() === "authorized";
  if (!confirmed && checkoutSession) {
    return {
      replay: false,
      event_id: String(notification.id),
      ignored: true,
      ignored_reason: "preapproval_not_authorized",
    };
  }

  // Public visitor checkout: use the exact reference when MP returns one,
  // otherwise resolve by provider id or by a unique plan+email candidate.
  // Legacy authenticated checkouts keep their original branch.
  if (!legacyExternal) {
    if (!confirmed) {
      return {
        replay: false,
        event_id: String(notification.id),
        ignored: true,
        ignored_reason: "preapproval_not_authorized",
      };
    }

    const resolved = await resolvePublicCheckoutSession({
      admin,
      preapprovalId,
      clientMutationId: checkoutSession?.clientMutationId,
      preapprovalPlanId: preapproval.preapprovalPlanId,
      payerEmail: preapproval.payerEmail,
      correlationId: options.correlationId,
    });
    if (!resolved.ok) {
      if (resolved.reason === "database") {
        throw new Error(resolved.error);
      }
      return {
        replay: false,
        event_id: String(notification.id),
        ignored: true,
        ignored_reason: resolved.error,
      };
    }

    const onboarding = await runVisitorOnboarding({
      clientMutationId: resolved.session.client_mutation_id,
      providerRef: preapprovalId,
      correlationId: options.correlationId,
    });
    return {
      replay: onboarding.status === "replayed",
      event_id: String(notification.id),
      ...(onboarding.status === "completed" || onboarding.status === "replayed"
        ? {
            ...(onboarding.subscriptionId ? { subscription_id: onboarding.subscriptionId } : {}),
            status: "active",
          }
        : {}),
      ...(onboarding.status === "session_not_found" ||
      onboarding.status === "missing_email" ||
      onboarding.status === "degraded" ||
      onboarding.status === "failed"
        ? { ignored: true }
        : {}),
      ...(onboarding.status === "degraded" || onboarding.status === "failed"
        ? {
            ...(onboarding.retryable !== false ? { retryable: true } : {}),
            ignored_reason: onboarding.status,
          }
        : {}),
    };
  }

  const external = legacyExternal;
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

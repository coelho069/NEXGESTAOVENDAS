/**
 * Mercado Pago Checkout Pro webhook (mp_webhook_approved).
 * Validates signature, confirms payment status via MP API, persists checkout_sessions
 * idempotently by mp_payment_id, then triggers onboarding email (Resend) and Telegram.
 */
import {
  isMercadoPagoCheckoutProPaymentApproved,
  isMercadoPagoCheckoutProWebhookTypeAllowed,
  type MercadoPagoCheckoutProWebhookNotification,
} from "@/lib/domain/mercadopago-checkout-pro";
import { parseCheckoutSessionExternalReference } from "@/lib/domain/onboarding-visitor";
import { createLogger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMercadoPagoEnv } from "@/lib/server/mercadopago";
import { createMercadoPagoCheckoutProGateway } from "@/lib/server/mercadopago-checkout-pro";
import {
  applyCheckoutSessionMpPayment,
  findCheckoutSessionByMpPaymentId,
} from "@/lib/server/public-checkout-sessions";
import { getTelegramNotifyConfig, sendTelegramMessage } from "@/lib/server/telegram-notify";
import {
  runVisitorOnboarding,
  type VisitorOnboardingOutcome,
} from "@/lib/server/visitor-onboarding";

const logger = createLogger({
  service: "nexgestaovendas",
  component: "mercadopago-checkout-pro-webhook",
});

export type PostPaymentAccessDelivery = {
  to: string;
  login: string;
  credential: "activation_link" | "claim_link";
  access_email_sent: boolean;
  verified_user_created: boolean;
  skipped?: boolean;
  skip_reason?: string;
};

export type MercadoPagoCheckoutProWebhookApplyResult = {
  replay: boolean;
  event_id: string;
  payment_id?: string;
  ignored?: boolean;
  ignored_reason?: string;
  notifications_sent?: boolean;
  subscription_id?: string;
  retryable?: boolean;
  access_delivery?: PostPaymentAccessDelivery;
};

function buildAccessDelivery(
  onboarding: VisitorOnboardingOutcome,
  payerEmail: string
): PostPaymentAccessDelivery | undefined {
  if (onboarding.status === "degraded" || onboarding.status === "failed") {
    return undefined;
  }
  if (onboarding.status === "missing_email") {
    return {
      to: "",
      login: "",
      credential: "activation_link",
      access_email_sent: false,
      verified_user_created: false,
      skipped: true,
      skip_reason: "missing_payer_email",
    };
  }
  if (
    onboarding.status !== "completed" &&
    onboarding.status !== "replayed" &&
    onboarding.status !== "session_not_found"
  ) {
    return undefined;
  }
  const login = onboarding.loginEmail ?? payerEmail.trim().toLowerCase();
  return {
    to: login,
    login,
    credential: "activation_link",
    access_email_sent: onboarding.accessEmailSent === true,
    verified_user_created: onboarding.verifiedUserCreated === true,
    ...(!onboarding.accessEmailSent && onboarding.status === "completed"
      ? { skipped: true, skip_reason: "email_sender_unconfigured_or_failed" }
      : {}),
  };
}

function resolveClientMutationId(input: {
  externalReference: string | null;
  preferenceExternalReference: string | null;
}): string | null {
  const candidates = [input.externalReference, input.preferenceExternalReference];
  for (const candidate of candidates) {
    const parsed = parseCheckoutSessionExternalReference(candidate);
    if (parsed) return parsed.clientMutationId;
    if (candidate && /^[0-9a-f-]{36}$/i.test(candidate.trim())) {
      return candidate.trim();
    }
  }
  return null;
}

async function notifyCheckoutApproved(input: {
  paymentId: string;
  payerEmail: string;
  planId: string;
  correlationId?: string;
}): Promise<boolean> {
  const telegramConfig = getTelegramNotifyConfig();
  if (!telegramConfig.configured) {
    logger.warn("checkout_pro_telegram_not_configured", {
      correlationId: input.correlationId,
      reason: telegramConfig.reason,
    });
    return false;
  }
  const sent = await sendTelegramMessage({
    config: telegramConfig,
    text: [
      "Pagamento Mercado Pago aprovado (Checkout Pro).",
      `payment_id: ${input.paymentId}`,
      `email: ${input.payerEmail}`,
      `plan_id: ${input.planId}`,
    ].join("\n"),
  });
  if (!sent.ok) {
    logger.warn("checkout_pro_telegram_send_failed", {
      correlationId: input.correlationId,
      error: sent.error,
    });
  }
  return sent.ok;
}

export async function applyMercadoPagoCheckoutProWebhookEvent(
  notification: MercadoPagoCheckoutProWebhookNotification,
  options: { correlationId?: string } = {}
): Promise<MercadoPagoCheckoutProWebhookApplyResult> {
  const eventId = String(notification.id);
  const paymentId = notification.data.id?.trim();
  if (!paymentId) {
    return { replay: false, event_id: eventId, ignored: true, ignored_reason: "payment_id_missing" };
  }

  if (!isMercadoPagoCheckoutProWebhookTypeAllowed(notification.type)) {
    return {
      replay: false,
      event_id: eventId,
      ignored: true,
      ignored_reason: "unsupported_webhook_type",
    };
  }

  const env = getMercadoPagoEnv();
  if (!env.configured) {
    throw new Error("mercadopago_checkout_pro_not_configured");
  }

  const admin = createAdminClient();
  if (!admin) {
    throw new Error("service_role_unavailable");
  }

  const existing = await findCheckoutSessionByMpPaymentId({
    admin,
    paymentId,
    correlationId: options.correlationId,
  });
  if (existing) {
    return {
      replay: true,
      event_id: eventId,
      payment_id: paymentId,
      notifications_sent: false,
    };
  }

  const gateway = createMercadoPagoCheckoutProGateway(env);
  const payment = await gateway.getPayment(paymentId);
  if (!payment) {
    return {
      replay: false,
      event_id: eventId,
      payment_id: paymentId,
      ignored: true,
      ignored_reason: "payment_not_found",
    };
  }

  if (!isMercadoPagoCheckoutProPaymentApproved(payment.status)) {
    return {
      replay: false,
      event_id: eventId,
      payment_id: payment.id,
      ignored: true,
      ignored_reason: `payment_status_${payment.status}`,
    };
  }

  let preferenceExternalReference: string | null = null;
  if (payment.preferenceId) {
    const preference = await gateway.getPreference(payment.preferenceId);
    preferenceExternalReference = preference?.externalReference ?? null;
  }

  const clientMutationId = resolveClientMutationId({
    externalReference: payment.externalReference,
    preferenceExternalReference,
  });
  if (!clientMutationId) {
    return {
      replay: false,
      event_id: eventId,
      payment_id: payment.id,
      ignored: true,
      ignored_reason: "checkout_session_reference_missing",
    };
  }

  const persisted = await applyCheckoutSessionMpPayment({
    admin,
    clientMutationId,
    paymentId: payment.id,
    paymentStatus: payment.status,
    preferenceId: payment.preferenceId,
    correlationId: options.correlationId,
  });
  if (!persisted.ok) {
    if (persisted.status === "database") {
      throw new Error(persisted.error);
    }
    return {
      replay: false,
      event_id: eventId,
      payment_id: payment.id,
      ignored: true,
      ignored_reason: persisted.error,
    };
  }

  if (persisted.replay) {
    return {
      replay: true,
      event_id: eventId,
      payment_id: payment.id,
      notifications_sent: false,
    };
  }

  const onboarding = await runVisitorOnboarding({
    clientMutationId,
    providerRef: payment.id,
    correlationId: options.correlationId,
  });

  const telegramSent = await notifyCheckoutApproved({
    paymentId: payment.id,
    payerEmail: persisted.session.payer_email,
    planId: persisted.session.plan_id,
    correlationId: options.correlationId,
  });

  const accessDelivery = buildAccessDelivery(onboarding, persisted.session.payer_email);

  const notificationsSent =
    telegramSent ||
    onboarding.status === "completed" ||
    onboarding.status === "replayed" ||
    onboarding.status === "missing_email";

  if (
    onboarding.status === "degraded" ||
    onboarding.status === "failed"
  ) {
    return {
      replay: false,
      event_id: eventId,
      payment_id: payment.id,
      notifications_sent: notificationsSent,
      ...(onboarding.retryable !== false ? { retryable: true } : {}),
      ignored: true,
      ignored_reason: onboarding.status,
      ...( "subscriptionId" in onboarding && onboarding.subscriptionId
        ? { subscription_id: onboarding.subscriptionId }
        : {}),
      ...(accessDelivery ? { access_delivery: accessDelivery } : {}),
    };
  }

  return {
    replay: onboarding.status === "replayed",
    event_id: eventId,
    payment_id: payment.id,
    notifications_sent: notificationsSent,
    ...( "subscriptionId" in onboarding && onboarding.subscriptionId
      ? { subscription_id: onboarding.subscriptionId }
      : {}),
    ...(accessDelivery ? { access_delivery: accessDelivery } : {}),
  };
}

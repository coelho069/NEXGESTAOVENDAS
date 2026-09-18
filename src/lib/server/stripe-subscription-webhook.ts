/**
 * Stripe subscription webhook branch (SaaS plans).
 *
 * checkout.session.completed events whose client_reference_id carries the
 * public checkout-session prefix are routed here to run the visitor onboarding
 * exactly once. PDV card/PIX events are untouched: their objects never carry
 * that reference, so this branch ignores them and the existing
 * applyStripeWebhookEventBranched keeps owning them.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { parseCheckoutSessionExternalReference } from "@/lib/domain/onboarding-visitor";
import { runVisitorOnboarding } from "@/lib/server/visitor-onboarding";
import { createLogger } from "@/lib/observability/logger";

type AdminClient = SupabaseClient<Database>;

const logger = createLogger({
  service: "nexgestaovendas",
  component: "stripe-subscription-webhook",
});

export type StripeSubscriptionWebhookResult = {
  handled: boolean;
  ignored?: boolean;
  ignored_reason?: string;
  retryable?: boolean;
  replay?: boolean;
  subscription_id?: string;
  status?: string;
};

export function isStripeSubscriptionCheckoutEvent(event: {
  type: string;
  data: { object: Record<string, unknown> };
}): boolean {
  if (event.type !== "checkout.session.completed") return false;
  const reference = event.data.object.client_reference_id;
  return parseCheckoutSessionExternalReference(
    typeof reference === "string" ? reference : null
  ) !== null;
}

export async function applyStripeSubscriptionWebhookEvent(input: {
  event: { id: string; type: string; data: { object: Record<string, unknown> } };
  admin: AdminClient;
  correlationId?: string;
}): Promise<StripeSubscriptionWebhookResult> {
  const object = input.event.data.object;
  const reference =
    typeof object.client_reference_id === "string" ? object.client_reference_id : null;
  const parsed = parseCheckoutSessionExternalReference(reference);
  if (!parsed) {
    return { handled: false, ignored: true, ignored_reason: "stripe_session_reference_missing" };
  }
  if (object.payment_status != null && object.payment_status !== "paid") {
    return {
      handled: true,
      ignored: true,
      ignored_reason: "stripe_session_not_paid",
    };
  }

  const onboarding = await runVisitorOnboarding({
    clientMutationId: parsed.clientMutationId,
    providerRef:
      typeof object.subscription === "string"
        ? object.subscription
        : typeof object.id === "string"
          ? object.id
          : input.event.id,
    correlationId: input.correlationId,
  });

  if (onboarding.status === "completed" || onboarding.status === "replayed") {
    return {
      handled: true,
      status: "active",
      subscription_id: onboarding.subscriptionId,
      replay: onboarding.status === "replayed",
    };
  }
  if (onboarding.status === "session_not_found" || onboarding.status === "missing_email") {
    return { handled: true, ignored: true, ignored_reason: onboarding.status };
  }
  logger.warn("stripe_subscription_onboarding_incomplete", {
    correlationId: input.correlationId,
    status: onboarding.status,
  });
  return {
    handled: true,
    ignored: true,
    ignored_reason: onboarding.status,
    ...(onboarding.retryable !== false ? { retryable: true } : {}),
  };
}

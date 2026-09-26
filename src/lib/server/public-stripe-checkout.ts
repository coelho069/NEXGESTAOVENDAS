/**
 * Public (unauthenticated) Stripe subscription checkout for plans mapped to a
 * Stripe Price via STRIPE_PRICE_PLAN_<SLUG>. Creates a hosted Checkout Session
 * (mode=subscription) and returns its URL; the confirmation arrives through
 * /api/payments/stripe/webhook (checkout.session.completed), which runs the
 * same visitor onboarding used by the Mercado Pago flows.
 *
 * Rails stay isolated: this module never touches Mercado Pago gateways and is
 * only reachable for plans with an explicit, valid Stripe mapping.
 */
import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStripeClient, getStripeCardEnv } from "@/lib/server/stripe-card";
import {
  buildCheckoutSessionExternalReference,
  SUBSCRIPTION_CHECKOUT_SESSION_PREFIX,
} from "@/lib/domain/onboarding-visitor";
import {
  isStripeSubscriptionCheckoutEnabled,
  resolveStripePriceIdForSlug,
  STRIPE_PRICE_PLAN_ENV_PREFIX,
} from "@/lib/domain/onboarding-stripe";
import {
  createPublicCheckoutSession,
  type CreatePublicCheckoutSessionResult,
} from "@/lib/server/public-checkout-sessions";
import { createLogger } from "@/lib/observability/logger";

const logger = createLogger({ service: "nexgestaovendas", component: "public-stripe-checkout" });

const STRIPE_SUBSCRIPTION_CHECKOUT_HOLD_MESSAGE =
  "Stripe subscription checkout em hold operacional até opt-in explícito (STRIPE_SUBSCRIPTION_CHECKOUT_ENABLED=true).";

export type PublicStripeCheckoutResult =
  | {
      ok: true;
      checkout_session_id: string;
      client_mutation_id: string;
      checkout_url: string;
      replayed: boolean;
    }
  | { ok: false; error: string; status: number };

export function stripeSubscriptionCheckoutHoldHealth(): {
  configured: false;
  message: string;
  reason: "stripe_subscription_checkout_hold";
} {
  return {
    configured: false,
    message: STRIPE_SUBSCRIPTION_CHECKOUT_HOLD_MESSAGE,
    reason: "stripe_subscription_checkout_hold",
  };
}

export function getPublicStripeCheckoutHealth(envSource: Record<string, string | undefined> = process.env): {
  configured: boolean;
  message: string;
  reason?: string;
} {
  if (!isStripeSubscriptionCheckoutEnabled(envSource)) {
    return stripeSubscriptionCheckoutHoldHealth();
  }
  const cardEnv = getStripeCardEnv(envSource);
  if (!cardEnv.configured) {
    return {
      configured: false,
      message: "Stripe não configurado.",
      reason: cardEnv.reason,
    };
  }
  const mapped = Object.keys(envSource).filter(
    (key) => key.startsWith(STRIPE_PRICE_PLAN_ENV_PREFIX) && envSource[key]?.trim()
  );
  return {
    configured: true,
    message:
      mapped.length > 0
        ? "Stripe configurado para planos mapeados."
        : "Stripe configurado, mas nenhum plano mapeado via STRIPE_PRICE_PLAN_*.",
  };
}

export async function executeMercadoPagoIndependentStripeCheckout(input: {
  planId: string;
  payerEmail: string;
  clientMutationId: string;
  correlationId?: string;
  envSource?: Record<string, string | undefined>;
}): Promise<PublicStripeCheckoutResult> {
  const envSource = input.envSource ?? process.env;
  if (!isStripeSubscriptionCheckoutEnabled(envSource)) {
    return { ok: false, error: "stripe_subscription_checkout_hold", status: 503 };
  }
  const cardEnv = getStripeCardEnv(envSource);
  if (!cardEnv.configured) {
    return { ok: false, error: "stripe_not_configured", status: 503 };
  }

  const admin = createAdminClient();
  if (!admin) {
    return { ok: false, error: "service_role_unavailable", status: 503 };
  }

  // Plan is resolved by internal id against the DB — never trust frontend data.
  const { data: plan, error: planError } = await admin
    .from("plans")
    .select("id, slug, name, amount, currency, billing_interval, is_active")
    .eq("id", input.planId)
    .maybeSingle();

  if (planError || !plan) {
    return { ok: false, error: "plan_not_found", status: 404 };
  }
  if (!plan.is_active) {
    return { ok: false, error: "plan_inactive", status: 400 };
  }

  // Provider gate: only plans with an explicit STRIPE_PRICE_PLAN_<SLUG> mapping
  // take this rail. Unmapped plans (all Mercado Pago ones) are refused.
  const stripePriceId = resolveStripePriceIdForSlug(plan.slug, envSource);
  if (!stripePriceId) {
    return { ok: false, error: "plan_not_stripe", status: 400 };
  }
  if (plan.currency !== "BRL") {
    return { ok: false, error: "plan_currency_unsupported", status: 400 };
  }

  const session: CreatePublicCheckoutSessionResult = await createPublicCheckoutSession({
    admin,
    planId: plan.id,
    payerEmail: input.payerEmail,
    clientMutationId: input.clientMutationId,
    correlationId: input.correlationId,
  });
  if (!session.ok) {
    return { ok: false, error: session.error, status: session.status };
  }

  const stripe = createStripeClient(cardEnv.secretKey, cardEnv.timeoutMs);
  try {
    const checkoutSession = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        line_items: [{ price: stripePriceId, quantity: 1 }],
        customer_email: input.payerEmail,
        // Binds the Stripe session back to the local public session so the
        // webhook can run onboarding exactly once (same prefix as MP hosted).
        client_reference_id: buildCheckoutSessionExternalReference(input.clientMutationId),
        metadata: {
          checkout_client_mutation_id: input.clientMutationId,
          plan_id: plan.id,
          rail: "stripe_subscription",
        },
        success_url: `${appOrigin(envSource)}/login?checkout=stripe&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appOrigin(envSource)}/#planos`,
      },
      { idempotencyKey: `nex-stripe-checkout:${input.clientMutationId}` }
    );

    if (!checkoutSession.url) {
      logger.error("public_stripe_checkout_missing_url", {
        correlationId: input.correlationId,
      });
      return { ok: false, error: "stripe_checkout_url_missing", status: 502 };
    }

    return {
      ok: true,
      checkout_session_id: checkoutSession.id,
      client_mutation_id: session.clientMutationId,
      checkout_url: checkoutSession.url,
      replayed: session.replayed,
    };
  } catch {
    logger.warn("public_stripe_checkout_create_failed", {
      correlationId: input.correlationId,
    });
    return { ok: false, error: "stripe_checkout_failed", status: 502 };
  }
}

function appOrigin(envSource: Record<string, string | undefined>): string {
  return envSource.APP_ORIGIN?.trim() || "http://localhost:3000";
}

export { SUBSCRIPTION_CHECKOUT_SESSION_PREFIX };

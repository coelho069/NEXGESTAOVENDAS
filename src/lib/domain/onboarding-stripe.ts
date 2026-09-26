/**
 * Pure domain helpers for Stripe-backed plans (SaaS subscriptions).
 *
 * Identification contract: a DB plan is Stripe-backed ONLY when the deploy
 * maps its catalog slug to a real Stripe Price via
 * `STRIPE_PRICE_PLAN_<SLUG_UPPER>` (e.g. STRIPE_PRICE_PLAN_ESSENCIAL=price_123).
 * Absent env → the plan is NOT stripe. No fallback, no guessing: Mercado Pago
 * plans never gain a Stripe option and provider-less plans never assume it.
 * No DB change and no credentials are involved in this module.
 */

export const STRIPE_PRICE_PLAN_ENV_PREFIX = "STRIPE_PRICE_PLAN_";

export type PlanProvider = "stripe" | "mercadopago";

/** Stripe Price ids look like price_<base62>; we only sanity-check the prefix. */
const STRIPE_PRICE_ID_PATTERN = /^price_[A-Za-z0-9]{8,}$/;

function slugToEnvKey(slug: string): string {
  return `${STRIPE_PRICE_PLAN_ENV_PREFIX}${slug
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")}`;
}

/**
 * Resolves the Stripe Price id mapped to a plan slug from the environment.
 * Returns null when the plan has no Stripe mapping (→ not a Stripe plan).
 */
export function resolveStripePriceIdForSlug(
  slug: string | null | undefined,
  envSource: Record<string, string | undefined> = process.env
): string | null {
  if (!slug || !slug.trim()) return null;
  const raw = envSource[slugToEnvKey(slug)]?.trim() ?? "";
  if (!raw) return null;
  return STRIPE_PRICE_ID_PATTERN.test(raw) ? raw : null;
}

/**
 * Provider of a plan for UI purposes. Strict: only an explicit, valid
 * STRIPE_PRICE_PLAN_* mapping yields "stripe"; everything else (including MP
 * plans and unmapped plans) yields null — callers must treat null as "no
 * stripe option", never as an assumption of any other provider.
 */
export function planProviderForSlug(
  slug: string | null | undefined,
  envSource: Record<string, string | undefined> = process.env
): PlanProvider | null {
  return resolveStripePriceIdForSlug(slug, envSource) ? "stripe" : null;
}

/** Strict opt-in. Unset/false stays hold. Never default true. */
export function isStripeSubscriptionCheckoutEnabledEnv(value: string | undefined): boolean {
  return value === "true";
}

/**
 * Sole subscription rail: Stripe Checkout (mode=subscription). Plans without a
 * STRIPE_PRICE_PLAN_<SLUG> mapping offer no subscription at all — there is no
 * Mercado Pago (or any other) fallback on the public plans page.
 *
 * Requires explicit STRIPE_SUBSCRIPTION_CHECKOUT_ENABLED=true (independent of
 * PDV card/PIX Stripe rails that share STRIPE_SECRET_KEY).
 */
export function isStripeSubscriptionCheckoutEnabled(
  envSource: Record<string, string | undefined> = process.env
): boolean {
  return isStripeSubscriptionCheckoutEnabledEnv(envSource.STRIPE_SUBSCRIPTION_CHECKOUT_ENABLED);
}

import type { SubscriptionBillingInterval } from "@/lib/domain/admin-subscriptions";

/** Public-facing plan card — no admin metrics or inactive flags. */
export type PublicPlanRecord = {
  id: string;
  name: string;
  description: string;
  amount: string;
  currency: string;
  billingInterval: SubscriptionBillingInterval;
  /**
   * Only plans with an explicit STRIPE_PRICE_PLAN_<SLUG> mapping enable the
   * Stripe subscription option; unmapped plans offer no subscription.
   */
  stripeEnabled: boolean;
};

export function comparePublicPlans(
  left: Pick<PublicPlanRecord, "name">,
  right: Pick<PublicPlanRecord, "name">
): number {
  return left.name.localeCompare(right.name, "pt-BR");
}

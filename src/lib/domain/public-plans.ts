import type { SubscriptionBillingInterval } from "@/lib/domain/admin-subscriptions";

/** Public-facing plan card — no admin metrics or inactive flags. */
export type PublicPlanRecord = {
  id: string;
  name: string;
  description: string;
  amount: string;
  currency: string;
  billingInterval: SubscriptionBillingInterval;
};

export function comparePublicPlans(
  left: Pick<PublicPlanRecord, "name">,
  right: Pick<PublicPlanRecord, "name">
): number {
  return left.name.localeCompare(right.name, "pt-BR");
}

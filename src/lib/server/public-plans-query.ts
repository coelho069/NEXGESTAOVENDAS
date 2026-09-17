import type { SubscriptionBillingInterval } from "@/lib/domain/admin-subscriptions";
import { comparePublicPlans, type PublicPlanRecord } from "@/lib/domain/public-plans";
import type { Tables } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

type PlanRow = Pick<
  Tables<"plans">,
  "id" | "name" | "description" | "amount" | "currency" | "billing_interval"
>;

export type PublicPlansQueryResult = {
  data: PublicPlanRecord[] | null;
  error: string | null;
};

const PUBLIC_PLANS_ERROR = "public_plans_unavailable";

function asAmount(value: number | string): string {
  return typeof value === "number" ? value.toFixed(2) : value;
}

function toPublicPlanRecord(plan: PlanRow): PublicPlanRecord {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    amount: asAmount(plan.amount),
    currency: plan.currency,
    billingInterval: plan.billing_interval as SubscriptionBillingInterval,
  };
}

export async function loadPublicPlans(): Promise<PublicPlansQueryResult> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("plans")
      .select("id, name, description, amount, currency, billing_interval")
      .eq("is_active", true)
      .order("name");

    if (error) {
      return { data: null, error: PUBLIC_PLANS_ERROR };
    }

    const plans = (data ?? [])
      .map(toPublicPlanRecord)
      .sort(comparePublicPlans);

    return { data: plans, error: null };
  } catch {
    return { data: null, error: PUBLIC_PLANS_ERROR };
  }
}

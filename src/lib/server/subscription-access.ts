import { createClient } from "@/lib/supabase/server";
import {
  gateTenantSubscriptionAccess,
  outcomeFromSubscriptionLookup,
  resolveSubscriptionCheck,
  type SubscriptionGateDecision,
  type SubscriptionLookupRow,
  type SubscriptionQueryOutcome,
} from "@/lib/domain/subscription-access";
import { rootLogger } from "@/lib/observability/logger";

const log = rootLogger.child({ component: "subscription-access" });

type LooseFilterBuilder = {
  eq: (column: string, value: string) => LooseQueryBuilder;
  limit: (count: number) => LooseQueryBuilder;
  order: (column: string, options?: { ascending?: boolean }) => LooseQueryBuilder;
};

type LooseQueryBuilder = PromiseLike<{
  data: SubscriptionLookupRow[] | null;
  error: { code?: string; message?: string; details?: string | null } | null;
}> &
  LooseFilterBuilder;

type LooseFromClient = {
  from: (relation: string) => { select: (columns: string) => LooseQueryBuilder };
};

/**
 * Optional billing schema — not in generated Database types until the
 * assinatura migration lands. Missing tables are `unavailable`, not `none`.
 */
async function queryTenantSubscription(orgId: string): Promise<SubscriptionQueryOutcome> {
  try {
    const supabase = (await createClient()) as unknown as LooseFromClient;
    const result = await supabase
      .from("subscriptions")
      .select("status")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(1);
    return outcomeFromSubscriptionLookup(result);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "subscription_query_threw";
    return { kind: "unavailable", detail };
  }
}

export async function resolveTenantSubscriptionGate(input: {
  orgId: string | null;
  skip?: boolean;
}): Promise<SubscriptionGateDecision> {
  if (input.skip) {
    return gateTenantSubscriptionAccess({
      recordedStatus: null,
      effectiveState: "active",
      reason: "ok",
    });
  }

  if (!input.orgId) {
    const decision = gateTenantSubscriptionAccess(
      resolveSubscriptionCheck({ kind: "unavailable", detail: "missing_org" })
    );
    log.warn("subscription_validation_unavailable", { reason: "missing_org" });
    return decision;
  }

  const outcome = await queryTenantSubscription(input.orgId);
  const check = resolveSubscriptionCheck(outcome);
  const decision = gateTenantSubscriptionAccess(check);

  if (check.effectiveState === "unavailable") {
    log.warn("subscription_validation_unavailable", {
      reason: check.reason,
      detail: outcome.kind === "unavailable" ? outcome.detail : undefined,
    });
  }

  return decision;
}

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  applyApprovedRefundBlock,
  applyPeriodEndExpiry,
  periodEndFromSubscriptionLookup,
  refundBlocksSubscription,
  payerEmailFromSubscriptionLookup,
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
  in: (column: string, values: readonly string[]) => LooseQueryBuilder;
  ilike: (column: string, pattern: string) => LooseQueryBuilder;
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
async function queryTenantSubscription(
  orgId: string
): Promise<{
  outcome: SubscriptionQueryOutcome;
  payerEmail: string | null;
  subscriptionCreatedAt: string | null;
  periodEnd: string | null;
}> {
  try {
    const supabase = (await createClient()) as unknown as LooseFromClient;
    const result = await supabase
      .from("subscriptions")
      .select("status, mp_payer_email, created_at, period_end")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(1);
    return {
      outcome: outcomeFromSubscriptionLookup(result),
      payerEmail: payerEmailFromSubscriptionLookup(result),
      subscriptionCreatedAt: subscriptionCreatedAtFromLookup(result),
      periodEnd: periodEndFromSubscriptionLookup(result),
    };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "subscription_query_threw";
    return { outcome: { kind: "unavailable", detail }, payerEmail: null, subscriptionCreatedAt: null, periodEnd: null };
  }
}

function subscriptionCreatedAtFromLookup(result: {
  data: SubscriptionLookupRow[] | null;
  error: unknown;
}): string | null {
  if (result.error) return null;
  const value = (result.data?.[0] as { created_at?: unknown } | undefined)?.created_at;
  return typeof value === "string" ? value : null;
}

function latestRefundInstant(row: { reviewed_at?: unknown; created_at?: unknown }): string | null {
  const raw = typeof row.reviewed_at === "string" ? row.reviewed_at : row.created_at;
  if (typeof raw !== "string") return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

type RefundLookupResult = { data: unknown[] | null; error: unknown };

function refundLookupDetail(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (cause && typeof cause === "object") {
    const error = cause as { message?: unknown; code?: unknown };
    if (typeof error.message === "string" && error.message.trim()) return error.message;
    if (typeof error.code === "string" && error.code.trim()) return error.code;
  }
  return "refund_lookup_failed";
}

/**
 * refund_requests is admin-only under RLS, so this read uses the service
 * client. A failed lookup does not block (fail-open). A confirmed approved
 * or refunded row for the payer e-mail or the requester still blocks.
 */
async function hasApprovedRefund(input: {
  payerEmail: string | null;
  userId?: string | null;
}): Promise<string | null> {
  if (!input.payerEmail && !input.userId) return null;
  try {
    const admin = createAdminClient() as unknown as LooseFromClient | null;
    if (!admin) return null;
    const checks: Array<PromiseLike<RefundLookupResult>> = [];
    if (input.payerEmail) {
      checks.push(
        admin
          .from("refund_requests")
          .select("id, reviewed_at, created_at")
          .in("status", ["approved", "refunded"])
          .ilike("payer_email", escapeLikePattern(input.payerEmail))
          .limit(1)
      );
    }
    if (input.userId) {
      checks.push(
        admin
          .from("refund_requests")
          .select("id, reviewed_at, created_at")
          .in("status", ["approved", "refunded"])
          .eq("requester_user_id", input.userId)
          .limit(1)
      );
    }
    const settled = await Promise.allSettled(checks.map((check) => Promise.resolve(check)));
    let latest: string | null = null;
    for (const item of settled) {
      if (item.status === "rejected") {
        log.warn("refund_block_lookup_failed", { detail: refundLookupDetail(item.reason) });
        continue;
      }
      if (item.value.error) {
        log.warn("refund_block_lookup_failed", { detail: refundLookupDetail(item.value.error) });
        continue;
      }
      if (!Array.isArray(item.value.data)) continue;
      for (const row of item.value.data as Array<{ reviewed_at?: unknown; created_at?: unknown }>) {
        const at = latestRefundInstant(row);
        if (at && (!latest || at > latest)) latest = at;
      }
    }
    return latest;
  } catch (cause) {
    log.warn("refund_block_lookup_failed", { detail: refundLookupDetail(cause) });
    return null;
  }
}

/** Session user for the requester check. Lookup failure is fail-open (null). */
async function sessionUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user?.id) return null;
    return user.id;
  } catch (cause) {
    log.warn("refund_block_user_lookup_failed", { detail: refundLookupDetail(cause) });
    return null;
  }
}

export async function resolveTenantSubscriptionGate(input: {
  orgId: string | null;
  userId?: string | null;
  skip?: boolean;
}): Promise<SubscriptionGateDecision> {
  if (input.skip) {
    return gateTenantSubscriptionAccess({
      recordedStatus: null,
      effectiveState: "active",
      reason: "ok",
    });
  }

  const userId = input.userId !== undefined ? input.userId : await sessionUserId();
  const { outcome, payerEmail, subscriptionCreatedAt, periodEnd } = input.orgId
    ? await queryTenantSubscription(input.orgId)
    : { outcome: { kind: "unavailable" as const, detail: "missing_org" }, payerEmail: null, subscriptionCreatedAt: null, periodEnd: null };
  const refundedAt = await hasApprovedRefund({ payerEmail, userId });
  // Bloqueia só a assinatura reembolsada: uma assinatura criada depois do
  // reembolso (o cliente assinou de novo) volta a dar acesso normal.
  const refunded = refundBlocksSubscription(refundedAt, subscriptionCreatedAt);
  const check = applyApprovedRefundBlock(
    applyPeriodEndExpiry(resolveSubscriptionCheck(outcome), periodEnd),
    refunded
  );
  const decision = gateTenantSubscriptionAccess(check);

  if (check.effectiveState === "unavailable") {
    if (!input.orgId) {
      log.warn("subscription_validation_unavailable", { reason: "missing_org" });
    } else {
      log.warn("subscription_validation_unavailable", {
        reason: check.reason,
        detail: outcome.kind === "unavailable" ? outcome.detail : undefined,
      });
    }
  }

  return decision;
}

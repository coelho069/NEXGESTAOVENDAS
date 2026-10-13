import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  applyApprovedRefundBlock,
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
): Promise<{ outcome: SubscriptionQueryOutcome; payerEmail: string | null }> {
  try {
    const supabase = (await createClient()) as unknown as LooseFromClient;
    const result = await supabase
      .from("subscriptions")
      .select("status, mp_payer_email")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(1);
    return {
      outcome: outcomeFromSubscriptionLookup(result),
      payerEmail: payerEmailFromSubscriptionLookup(result),
    };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "subscription_query_threw";
    return { outcome: { kind: "unavailable", detail }, payerEmail: null };
  }
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
 * row for the payer e-mail or the requester still blocks.
 */
async function hasApprovedRefund(input: {
  payerEmail: string | null;
  userId?: string | null;
}): Promise<boolean> {
  if (!input.payerEmail && !input.userId) return false;
  try {
    const admin = createAdminClient() as unknown as LooseFromClient | null;
    if (!admin) return false;
    const checks: Array<PromiseLike<RefundLookupResult>> = [];
    if (input.payerEmail) {
      checks.push(
        admin
          .from("refund_requests")
          .select("id")
          .eq("status", "approved")
          .ilike("payer_email", escapeLikePattern(input.payerEmail))
          .limit(1)
      );
    }
    if (input.userId) {
      checks.push(
        admin
          .from("refund_requests")
          .select("id")
          .eq("status", "approved")
          .eq("requester_user_id", input.userId)
          .limit(1)
      );
    }
    const settled = await Promise.allSettled(checks.map((check) => Promise.resolve(check)));
    let matched = false;
    for (const item of settled) {
      if (item.status === "rejected") {
        log.warn("refund_block_lookup_failed", { detail: refundLookupDetail(item.reason) });
        continue;
      }
      if (item.value.error) {
        log.warn("refund_block_lookup_failed", { detail: refundLookupDetail(item.value.error) });
        continue;
      }
      if (Array.isArray(item.value.data) && item.value.data.length > 0) matched = true;
    }
    return matched;
  } catch (cause) {
    log.warn("refund_block_lookup_failed", { detail: refundLookupDetail(cause) });
    return false;
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
  const { outcome, payerEmail } = input.orgId
    ? await queryTenantSubscription(input.orgId)
    : { outcome: { kind: "unavailable" as const, detail: "missing_org" }, payerEmail: null };
  const refunded = await hasApprovedRefund({ payerEmail, userId });
  const check = applyApprovedRefundBlock(resolveSubscriptionCheck(outcome), refunded);
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

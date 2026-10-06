import { getPlatformAdminAccess } from "@/lib/auth/admin";
import { money, toMoneyString } from "@/lib/money";
import {
  summarizeTrustedPaymentSnapshots,
  type TrustedOutstanding,
} from "@/lib/domain/refund-outstanding";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRefundRequestStore, type RefundRequestRow } from "@/lib/server/refund-requests";

export async function loadRefundRequests(): Promise<{
  data: RefundRequestRow[] | null;
  error: string | null;
}> {
  const access = await getPlatformAdminAccess();
  if (!access) return { data: null, error: "forbidden" };

  const admin = createAdminClient();
  if (!admin) return { data: null, error: "service_role_unavailable" };

  try {
    const data = await createRefundRequestStore(admin).listRecent(100);
    return { data, error: null };
  } catch {
    return { data: null, error: "unavailable" };
  }
}

type OutstandingQuery = {
  from(table: "checkout_sessions"): {
    select(columns: "mp_payment_id, transaction_amount, transaction_currency"): {
      in(
        column: "mp_payment_id",
        values: string[]
      ): Promise<{ data: Array<Record<string, unknown>> | null; error: { message?: string } | null }>;
    };
  };
};

export async function loadApprovedUnsentOutstanding(rows: RefundRequestRow[]): Promise<TrustedOutstanding | null> {
  const paymentIds = rows
    .filter((row) => row.status === "approved" && row.provider_refund_status === "not_sent")
    .map((row) => row.mp_payment_id);
  if (paymentIds.length === 0) {
    return { reliableTotal: "0.00", reliableCount: 0, unavailableCount: 0 };
  }

  const admin = createAdminClient();
  if (!admin) return null;

  const result = await (admin as unknown as OutstandingQuery)
    .from("checkout_sessions")
    .select("mp_payment_id, transaction_amount, transaction_currency")
    .in("mp_payment_id", paymentIds);
  if (result.error || !result.data) return null;

  return summarizeTrustedPaymentSnapshots(
    paymentIds,
    result.data.map((row) => ({
      mp_payment_id: typeof row.mp_payment_id === "string" ? row.mp_payment_id : null,
      transaction_amount: row.transaction_amount,
      transaction_currency: row.transaction_currency,
    }))
  );
}

export type RefundSandboxPresentation = {
  snapshot_amount: string | null;
  snapshot_currency: string | null;
  payment_method: "Checkout Pro";
  processing_state: string | null;
  processing_error_class: string | null;
  provider_refund_status: string;
  retryable: boolean;
};

type SnapshotQuery = {
  from(table: "checkout_sessions"): {
    select(columns: "mp_payment_id, transaction_amount, transaction_currency"): {
      in(
        column: "mp_payment_id",
        values: string[]
      ): Promise<{ data: Array<Record<string, unknown>> | null; error: { message?: string } | null }>;
    };
  };
};

function snapshotAmount(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^(?:0|[1-9]\d{0,9})\.\d{2}$/.test(trimmed) && money(trimmed).gt(0)) return trimmed;
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const text = toMoneyString(money(value));
    if (/^(?:0|[1-9]\d{0,9})\.\d{2}$/.test(text) && money(text).eq(value) && money(text).gt(0)) return text;
  }
  return null;
}

/** Display amount comes only from checkout_sessions.transaction_amount. */
export async function loadRefundSandboxPresentation(
  rows: RefundRequestRow[]
): Promise<Record<string, RefundSandboxPresentation>> {
  const presentation: Record<string, RefundSandboxPresentation> = {};
  const paymentIds = [...new Set(rows.map((row) => row.mp_payment_id))];
  const admin = createAdminClient();
  let amountByPayment = new Map<string, { amount: string | null; currency: string | null }>();
  if (admin && paymentIds.length > 0) {
    const result = await (admin as unknown as SnapshotQuery)
      .from("checkout_sessions")
      .select("mp_payment_id, transaction_amount, transaction_currency")
      .in("mp_payment_id", paymentIds);
    if (!result.error && result.data) {
      amountByPayment = new Map(
        result.data.map((row) => [
          String(row.mp_payment_id ?? ""),
          {
            amount: snapshotAmount(row.transaction_amount),
            currency: row.transaction_currency === "BRL" ? "BRL" : null,
          },
        ])
      );
    }
  }

  for (const row of rows) {
    const extra = row as RefundRequestRow & {
      processing_state?: string | null;
      processing_error_class?: string | null;
      provider_refund_status?: string;
    };
    const processingState = extra.processing_state ?? null;
    const errorClass = extra.processing_error_class ?? null;
    const snapshot = amountByPayment.get(row.mp_payment_id);
    presentation[row.id] = {
      snapshot_amount: snapshot?.amount ?? null,
      snapshot_currency: snapshot?.currency ?? null,
      payment_method: "Checkout Pro",
      processing_state: processingState,
      processing_error_class: errorClass,
      provider_refund_status: extra.provider_refund_status ?? row.provider_refund_status,
      retryable:
        (processingState === "failed" && errorClass === "temporary") ||
        (processingState === "unknown" && errorClass === "timeout"),
    };
  }
  return presentation;
}

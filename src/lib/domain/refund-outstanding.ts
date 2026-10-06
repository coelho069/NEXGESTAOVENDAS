import { isExactRefundMoney } from "@/lib/domain/mercadopago-refund";
import { money, sumMoney } from "@/lib/money";

export type TrustedOutstanding = {
  reliableTotal: string;
  reliableCount: number;
  unavailableCount: number;
};

export type CheckoutSnapshotRow = {
  mp_payment_id?: string | null;
  transaction_amount?: unknown;
  transaction_currency?: unknown;
  plan_amount?: unknown;
};

function trustedAmount(row: CheckoutSnapshotRow): string | null {
  if (row.transaction_currency !== "BRL") return null;
  const value = row.transaction_amount;
  if (typeof value === "string" && isExactRefundMoney(value.trim()) && money(value.trim()).gt(0)) {
    return value.trim();
  }
  return null;
}

/**
 * Sums historical checkout snapshots only.
 * A missing, conflicting, or non-BRL snapshot stays unavailable.
 */
export function summarizeTrustedPaymentSnapshots(
  paymentIds: string[],
  sessions: CheckoutSnapshotRow[]
): TrustedOutstanding {
  const unique = [...new Set(paymentIds)];
  const amountsByPayment = new Map<string, Set<string>>();
  const seen = new Set<string>();
  for (const session of sessions) {
    const paymentId = typeof session.mp_payment_id === "string" ? session.mp_payment_id : "";
    if (!paymentId || !unique.includes(paymentId)) continue;
    seen.add(paymentId);
    const amount = trustedAmount(session);
    const bucket = amountsByPayment.get(paymentId) ?? new Set<string>();
    if (amount) bucket.add(amount);
    else bucket.add("");
    amountsByPayment.set(paymentId, bucket);
  }

  const reliable: string[] = [];
  let unavailableCount = 0;
  for (const paymentId of unique) {
    const bucket = amountsByPayment.get(paymentId);
    const amounts = [...(bucket ?? [])].filter((amount) => amount !== "");
    if (!seen.has(paymentId) || !bucket || bucket.has("") || amounts.length !== 1) {
      unavailableCount += 1;
      continue;
    }
    reliable.push(amounts[0]);
  }

  return {
    reliableTotal: reliable.length === 0 ? "0.00" : sumMoney(reliable),
    reliableCount: reliable.length,
    unavailableCount,
  };
}

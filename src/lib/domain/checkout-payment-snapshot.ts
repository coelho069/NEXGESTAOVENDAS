import Decimal from "decimal.js";
import { isExactRefundMoney, REFUND_MONEY } from "@/lib/domain/mercadopago-refund";

/**
 * Amount confirmed by the payment provider at approval time.
 * Plan price and contracted_amount are not inputs.
 */
export type ConfirmedPaymentSnapshot = {
  transactionAmount: string;
  transactionCurrency: string;
  transactionPaidAt: string;
};

/** Accepts an exact cent value. Rejects amounts that would need rounding. */
export function exactConfirmedMoney(amount: unknown): string | null {
  let decimal: Decimal;
  if (typeof amount === "number") {
    if (!Number.isFinite(amount)) return null;
    decimal = new Decimal(amount.toString());
  } else if (typeof amount === "string") {
    const trimmed = amount.trim();
    if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(trimmed)) return null;
    decimal = new Decimal(trimmed);
  } else {
    return null;
  }
  if (!decimal.isFinite() || decimal.lte(0) || decimal.decimalPlaces() > 2) return null;
  const fixed = decimal.toFixed(2);
  return REFUND_MONEY.test(fixed) ? fixed : null;
}

export function confirmedSnapshotFromPayment(payment: {
  transactionAmount: string | null;
  currencyId: string | null;
  dateApproved: string | null;
}): ConfirmedPaymentSnapshot | null {
  if (!payment.transactionAmount || !isExactRefundMoney(payment.transactionAmount)) return null;
  const currency = payment.currencyId?.trim().toUpperCase() ?? "";
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  if (!payment.dateApproved) return null;
  const paidAtMs = Date.parse(payment.dateApproved);
  if (Number.isNaN(paidAtMs)) return null;
  return {
    transactionAmount: payment.transactionAmount,
    transactionCurrency: currency,
    transactionPaidAt: new Date(paidAtMs).toISOString(),
  };
}

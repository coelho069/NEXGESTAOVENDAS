export const PAYMENT_STATES = [
  "pending",
  "authorized",
  "captured",
  "failed",
  "unknown",
  "cancelled",
  "refunded",
] as const;

export type PaymentState = (typeof PAYMENT_STATES)[number];

const TRANSITIONS: Record<PaymentState, readonly PaymentState[]> = {
  pending: ["authorized", "captured", "failed", "unknown", "cancelled"],
  authorized: ["captured", "unknown", "cancelled"],
  captured: ["refunded"],
  failed: [],
  unknown: ["captured", "failed", "cancelled"],
  cancelled: [],
  refunded: [],
};

export function canTransitionPayment(from: PaymentState, to: PaymentState): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export function assertPaymentTransition(from: PaymentState, to: PaymentState): void {
  if (!canTransitionPayment(from, to)) {
    throw new Error(`Invalid payment status transition: ${from} -> ${to}`);
  }
}

export function isPaymentTerminal(status: PaymentState): boolean {
  return status === "captured" || status === "failed" || status === "cancelled" || status === "refunded";
}

export function isPaymentOutcomeUnknown(status: PaymentState): boolean {
  return status === "unknown";
}

/** Semantic "paid" in PIX docs maps to persisted captured. */
export function isPaymentPaid(status: PaymentState): boolean {
  return status === "captured";
}

/**
 * Expired PIX charges are persisted as failed with failure_code=expired.
 * The DB enum has no separate expired value (avoid duplicate statuses).
 */
export function paymentStatusForExpiredCharge(): PaymentState {
  return "failed";
}

export const PIX_EXPIRED_FAILURE_CODE = "expired";

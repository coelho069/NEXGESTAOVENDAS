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

import { money } from "@/lib/money";
import type { RefundRequestStatus } from "@/lib/domain/refund-request";

/**
 * Dry-run refund settlement for Checkout Pro.
 * The analysis row stays `approved` and `provider_refund_status` stays `not_sent`.
 * `processing_simulated` is not a completed refund.
 */

export const REFUND_MONEY = /^(?:0|[1-9]\d{0,9})\.\d{2}$/;

export const REFUND_AUDIT_EVENTS = [
  "refund_processing_started",
  "refund_processing_dry_run",
  "refund_processing_succeeded",
  "refund_processing_failed",
  "refund_processing_timeout",
  "refund_provider_confirmed",
] as const;

export type RefundAuditEventName = (typeof REFUND_AUDIT_EVENTS)[number];

export type RefundAuditEvent = {
  event: RefundAuditEventName;
  refundRequestId: string;
  idempotencyKey: string;
  outcome: "processing" | "processing_simulated" | "failed" | "refunded" | "succeeded" | "timeout";
};

/** Server-owned Checkout Pro payment. Amount is null until a snapshot exists. */
export type PersistedCheckoutPayment = {
  mpPaymentId: string;
  ownerUserId: string;
  currency: string | null;
  amount: string | null;
  provider: "mercadopago";
  status: string;
};

export type RefundProcessingRequest = {
  id: string;
  status: RefundRequestStatus;
  mpPaymentId: string;
  ownerUserId: string;
};

/** Fields a browser might send. None of them authorize or price a refund. */
export type UntrustedRefundCommand = {
  payerEmail?: unknown;
  amount?: unknown;
  approvedAmount?: unknown;
  requestedAmount?: unknown;
  provider?: unknown;
  providerRefundId?: unknown;
  currency?: unknown;
  transactionAmount?: unknown;
  transactionPaidAt?: unknown;
  idempotencyKey?: unknown;
};

export type RefundEligibility =
  | {
      ok: true;
      amount: string;
      currency: "BRL";
      idempotencyKey: string;
    }
  | { ok: false; error: string };

export type BuiltRefundRequest = {
  idempotencyKey: string;
  mpPaymentId: string;
  amount: string;
  currency: "BRL";
};

export type NormalizedRefundResponse = {
  mode: "dry_run" | "provider_confirmed" | "provider_failed";
  status: "processing_simulated" | "refunded" | "failed";
  financialEffect: boolean;
  providerRefundId: string | null;
  providerRefundStatus: "not_sent";
  failure: "timeout" | "provider_error" | null;
};

export type MercadoPagoRefundAdapter = {
  validateRefundEligibility(input: {
    request: RefundProcessingRequest;
    payment: PersistedCheckoutPayment;
    actorUserId: string;
  }): RefundEligibility;
  buildRefundRequest(eligibility: Extract<RefundEligibility, { ok: true }>, payment: PersistedCheckoutPayment): BuiltRefundRequest;
  executeRefund(request: BuiltRefundRequest): Promise<NormalizedRefundResponse>;
  normalizeRefundResponse(raw: unknown): NormalizedRefundResponse | null;
};

export function refundIdempotencyKey(refundRequestId: string): string {
  return `mercadopago:refund:${refundRequestId}`;
}

export function isExactRefundMoney(value: string): boolean {
  return REFUND_MONEY.test(value);
}

/** Rejects values that would need rounding. Never calls toFixed. */
export function compareExactMoney(left: string, right: string): -1 | 0 | 1 | null {
  if (!isExactRefundMoney(left) || !isExactRefundMoney(right)) return null;
  const comparison = money(left).cmp(money(right));
  if (comparison < 0) return -1;
  if (comparison > 0) return 1;
  return 0;
}

export function rejectUntrustedRefundCommand(
  command: UntrustedRefundCommand | undefined,
  eligibleAmount: string | null
): string | null {
  if (!command) return null;
  if (command.providerRefundId !== undefined) return "client_provider_refund_id_rejected";
  if (command.provider !== undefined) return "client_provider_rejected";
  if (command.idempotencyKey !== undefined) return "client_idempotency_key_rejected";
  if (command.transactionPaidAt !== undefined) return "client_paid_at_rejected";
  if (command.transactionAmount !== undefined) return "client_transaction_amount_rejected";
  if (command.currency !== undefined && command.currency !== "BRL") return "invalid_currency";
  if (command.currency !== undefined) return "client_currency_rejected";
  const amountError = rejectClientAmount(command.approvedAmount, eligibleAmount)
    ?? rejectClientAmount(command.requestedAmount, eligibleAmount)
    ?? rejectClientAmount(command.amount, eligibleAmount);
  return amountError;
}

function rejectClientAmount(value: unknown, eligibleAmount: string | null): string | null {
  if (value === undefined) return null;
  if (typeof value === "number" && value < 0) return "negative_amount";
  if (typeof value === "string" && value.trim().startsWith("-")) return "negative_amount";
  if (typeof value !== "string" || !isExactRefundMoney(value)) return "client_amount_rejected";
  if (eligibleAmount && compareExactMoney(value, eligibleAmount) === 1) return "amount_exceeds_paid";
  return "client_amount_rejected";
}

/**
 * Refund amount comes only from the persisted provider snapshot.
 * planAmount and contractedAmount are accepted so callers can pass them and
 * still be ignored. They are never a fallback.
 */
export function persistedRefundAmount(
  snapshot: { transactionAmount: string | null; transactionCurrency: string | null },
  _catalog: { planAmount?: string | null; contractedAmount?: string | null } = {}
): { ok: true; amount: string; currency: "BRL" } | { ok: false; error: "paid_amount_unavailable" | "invalid_currency" | "invalid_amount" } {
  void _catalog.planAmount;
  void _catalog.contractedAmount;
  if (snapshot.transactionAmount == null || snapshot.transactionAmount.trim() === "") {
    return { ok: false, error: "paid_amount_unavailable" };
  }
  if (snapshot.transactionCurrency !== "BRL") return { ok: false, error: "invalid_currency" };
  if (!isExactRefundMoney(snapshot.transactionAmount) || money(snapshot.transactionAmount).lte(0)) {
    return { ok: false, error: "invalid_amount" };
  }
  return { ok: true, amount: snapshot.transactionAmount, currency: "BRL" };
}

/**
 * Checkout Pro ownership stays on mp_payment_id and onboarding_user_id.
 * The payable amount is the persisted transaction snapshot only.
 */
export function assessCheckoutProRefundLinkage(input: {
  mpPaymentId: string | null;
  onboardingUserId: string | null;
  mpPaymentStatus: string | null;
  transactionAmount: string | null;
  currency: string | null;
  planAmount?: string | null;
  contractedAmount?: string | null;
}): { ok: true; payment: PersistedCheckoutPayment } | { ok: false; error: string } {
  const mpPaymentId = input.mpPaymentId?.trim() ?? "";
  if (!/^\d{6,20}$/.test(mpPaymentId)) return { ok: false, error: "payment_not_linked" };
  const ownerUserId = input.onboardingUserId?.trim() ?? "";
  if (!ownerUserId) return { ok: false, error: "owner_not_linked" };
  const status = input.mpPaymentStatus?.trim().toLowerCase() ?? "";
  if (!status) return { ok: false, error: "provider_not_identified" };
  const priced = persistedRefundAmount(
    { transactionAmount: input.transactionAmount, transactionCurrency: input.currency },
    { planAmount: input.planAmount, contractedAmount: input.contractedAmount }
  );
  if (!priced.ok) return priced;
  return {
    ok: true,
    payment: {
      mpPaymentId,
      ownerUserId,
      currency: "BRL",
      amount: priced.amount,
      provider: "mercadopago",
      status,
    },
  };
}

export function validateRefundEligibility(input: {
  request: RefundProcessingRequest;
  payment: PersistedCheckoutPayment | null;
  actorUserId: string | null;
}): RefundEligibility {
  if (!input.actorUserId) return { ok: false, error: "unauthenticated" };
  if (!input.payment) return { ok: false, error: "payment_not_found" };
  if (input.payment.provider !== "mercadopago") return { ok: false, error: "provider_not_identified" };
  if (input.request.ownerUserId !== input.actorUserId || input.payment.ownerUserId !== input.actorUserId) {
    return { ok: false, error: "not_owner" };
  }
  if (input.request.mpPaymentId !== input.payment.mpPaymentId) return { ok: false, error: "payment_not_owned" };
  if (input.request.status !== "approved") return { ok: false, error: "not_approved" };
  const paidStatus = input.payment.status.trim().toLowerCase();
  if (!["approved", "accredited", "paid"].includes(paidStatus)) return { ok: false, error: "unpaid" };
  if (input.payment.currency !== "BRL") return { ok: false, error: "invalid_currency" };
  if (input.payment.amount == null) return { ok: false, error: "paid_amount_unavailable" };
  if (!isExactRefundMoney(input.payment.amount) || money(input.payment.amount).lte(0)) {
    return { ok: false, error: "invalid_amount" };
  }
  return {
    ok: true,
    amount: input.payment.amount,
    currency: "BRL",
    idempotencyKey: refundIdempotencyKey(input.request.id),
  };
}

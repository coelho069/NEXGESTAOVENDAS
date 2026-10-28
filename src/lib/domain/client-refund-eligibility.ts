/**
 * Eligibility for a signed-in client to open a SaaS refund analysis request.
 * Ownership and the 7-day window are decided here. Nothing in this module
 * calls Mercado Pago or Stripe.
 */
import {
  REFUND_REQUEST_REASONS,
  refundWindowContainsInstant,
  saoPauloDateFromInstant,
  type RefundRequestReason,
  type RefundRequestStatus,
} from "@/lib/domain/refund-request";

export const CLIENT_REFUND_PAID_STATUSES = ["approved", "accredited", "paid"] as const;

const PAID_STATUSES = new Set<string>(CLIENT_REFUND_PAID_STATUSES);
const PAYMENT_ID = /^\d{6,20}$/;
const OPEN_REQUEST_STATUSES = new Set<string>(["submitted", "in_review"]);
/** A payment already approved or refunded can never receive another request. */
const APPROVED_REQUEST_STATUSES = new Set<string>(["approved", "refunded"]);

export type ClientRefundActor = {
  userId: string;
  email: string;
  orgId: string | null;
};

export type ClientCheckoutPayment = {
  id: string;
  payerEmail: string;
  mpPaymentId: string | null;
  mpPaymentStatus: string | null;
  mpPaymentPaidAt: string | null;
  onboardingUserId: string | null;
  onboardingOrganizationId: string | null;
};

export type ClientRefundBlockReason =
  | "not_owner"
  | "missing_payment"
  | "unpaid"
  | "unknown_paid_on"
  | "outside_window"
  | "open_request"
  | "already_refunded"
  | "intensive_use";

export type ClientRefundPaymentView = {
  mpPaymentId: string;
  paidOn: string | null;
  eligible: boolean;
  blockReason: "unknown_paid_on" | "outside_window" | "open_request" | null;
  latestStatus: RefundRequestStatus | "processing" | "refunded" | null;
};

export const CLIENT_REFUND_FORM_REASONS = REFUND_REQUEST_REASONS;

export type ClientRefundFormReason = RefundRequestReason;

export function normalizeRefundActorEmail(email: string): string {
  return email.trim().toLowerCase();
}

export { saoPauloDateFromInstant };

/** processing covers in-flight claims and unknown outcomes: both block a new request. */
export function refundRequestIsOpen(status: string): boolean {
  return OPEN_REQUEST_STATUSES.has(status) || status === "processing";
}

/**
 * approved + failed is a definitive provider failure: the refund did not happen, so it is not
 * counted as refunded and the client may ask again. Any other approved state counts as refunded.
 */
export function refundRequestIsApproved(status: string, processingState?: string | null): boolean {
  if (status === "refunded") return true;
  if (!APPROVED_REQUEST_STATUSES.has(status)) return false;
  return processingState !== "failed";
}

/**
 * A checkout belongs to the actor when onboarding linked their user id.
 * Without that link, the payer e-mail must match and the organization, when
 * both sides have one, must be the same.
 */
export function clientOwnsCheckoutPayment(
  actor: ClientRefundActor,
  payment: ClientCheckoutPayment
): boolean {
  if (payment.onboardingUserId) {
    return payment.onboardingUserId === actor.userId;
  }
  const email = normalizeRefundActorEmail(actor.email);
  const payer = normalizeRefundActorEmail(payment.payerEmail);
  if (!email || payer !== email) return false;
  if (
    payment.onboardingOrganizationId &&
    actor.orgId &&
    payment.onboardingOrganizationId !== actor.orgId
  ) {
    return false;
  }
  return true;
}

export function assessClientRefundEligibility(input: {
  actor: ClientRefundActor;
  payment: ClientCheckoutPayment;
  now: Date;
  openRequest: boolean;
  refundApproved?: boolean;
  intensiveUseDeclared?: boolean;
}):
  | { eligible: true; mpPaymentId: string; paidOn: string }
  | { eligible: false; reason: ClientRefundBlockReason } {
  if (!clientOwnsCheckoutPayment(input.actor, input.payment)) {
    return { eligible: false, reason: "not_owner" };
  }
  const mpPaymentId = input.payment.mpPaymentId?.trim() ?? "";
  if (!PAYMENT_ID.test(mpPaymentId)) {
    return { eligible: false, reason: "missing_payment" };
  }
  const status = input.payment.mpPaymentStatus?.trim().toLowerCase() ?? "";
  if (!PAID_STATUSES.has(status)) {
    return { eligible: false, reason: "unpaid" };
  }
  const paidAt = input.payment.mpPaymentPaidAt ? new Date(input.payment.mpPaymentPaidAt) : null;
  if (!paidAt || Number.isNaN(paidAt.getTime())) {
    return { eligible: false, reason: "unknown_paid_on" };
  }
  const paidOn = saoPauloDateFromInstant(paidAt.toISOString());
  if (!paidOn) return { eligible: false, reason: "unknown_paid_on" };
  if (paidAt.getTime() > input.now.getTime()) {
    return { eligible: false, reason: "unknown_paid_on" };
  }
  if (!refundWindowContainsInstant(paidAt, input.now)) {
    return { eligible: false, reason: "outside_window" };
  }
  if (input.refundApproved) return { eligible: false, reason: "already_refunded" };
  if (input.openRequest) return { eligible: false, reason: "open_request" };
  if (input.intensiveUseDeclared) return { eligible: false, reason: "intensive_use" };
  return { eligible: true, mpPaymentId, paidOn };
}

export function visibleClientRefundPayments(
  views: ClientRefundPaymentView[]
): ClientRefundPaymentView[] {
  return views.filter((view) => view.eligible || view.blockReason === "open_request");
}

export function presentClientRefundPayments(input: {
  actor: ClientRefundActor;
  checkouts: ClientCheckoutPayment[];
  requests: Array<{
    mpPaymentId: string;
    status: RefundRequestStatus | "processing" | "refunded";
    processingState?: string | null;
    createdAt: string;
  }>;
  now: Date;
}): ClientRefundPaymentView[] {
  const latestByPayment = new Map<string, { status: RefundRequestStatus | "processing" | "refunded"; createdAt: string }>();
  for (const request of input.requests) {
    const current = latestByPayment.get(request.mpPaymentId);
    if (!current || request.createdAt > current.createdAt) {
      latestByPayment.set(request.mpPaymentId, {
        status: request.status,
        createdAt: request.createdAt,
      });
    }
  }

  const approvedPayments = new Set<string>();
  for (const request of input.requests) {
    if (refundRequestIsApproved(request.status, request.processingState)) {
      approvedPayments.add(request.mpPaymentId);
    }
  }

  const seen = new Set<string>();
  const views: ClientRefundPaymentView[] = [];
  for (const checkout of input.checkouts) {
    const paymentId = checkout.mpPaymentId?.trim() ?? "";
    if (!PAYMENT_ID.test(paymentId) || seen.has(paymentId)) continue;
    if (!clientOwnsCheckoutPayment(input.actor, checkout)) continue;
    const status = checkout.mpPaymentStatus?.trim().toLowerCase() ?? "";
    if (!PAID_STATUSES.has(status)) continue;
    seen.add(paymentId);
    const latest = latestByPayment.get(paymentId) ?? null;
    const eligibility = assessClientRefundEligibility({
      actor: input.actor,
      payment: checkout,
      now: input.now,
      openRequest: latest ? refundRequestIsOpen(latest.status) : false,
      refundApproved: approvedPayments.has(paymentId),
    });
    views.push({
      mpPaymentId: paymentId,
      paidOn: eligibility.eligible
        ? eligibility.paidOn
        : checkout.mpPaymentPaidAt
          ? saoPauloDateFromInstant(checkout.mpPaymentPaidAt)
          : null,
      eligible: eligibility.eligible,
      blockReason: eligibility.eligible
        ? null
        : eligibility.reason === "outside_window" ||
            eligibility.reason === "unknown_paid_on" ||
            eligibility.reason === "open_request"
          ? eligibility.reason
          : null,
      latestStatus: latest?.status ?? null,
    });
  }

  return views.sort((left, right) => (right.paidOn ?? "").localeCompare(left.paidOn ?? ""));
}

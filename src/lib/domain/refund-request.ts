/**
 * SaaS refund request workflow. Decisions stay in the database.
 * Approving a request never calls Mercado Pago or Stripe.
 */

export const REFUND_REQUEST_STATUSES = [
  "submitted",
  "in_review",
  "approved",
  "rejected",
  "withdrawn",
] as const;

export type RefundRequestStatus = (typeof REFUND_REQUEST_STATUSES)[number];

export const REFUND_REQUEST_REASONS = [
  "arrependimento",
  "cobranca_indevida",
  "cobranca_duplicada",
  "falha_no_servico",
  "problema_tecnico",
  "outro",
] as const;

export type RefundRequestReason = (typeof REFUND_REQUEST_REASONS)[number];

export const REFUND_REVIEW_ACTIONS = ["start_review", "approve", "reject"] as const;

export type RefundReviewAction = (typeof REFUND_REVIEW_ACTIONS)[number];

export const REFUND_WINDOW_ASSESSMENTS = ["within_window", "outside_window", "unknown"] as const;

export type RefundWindowAssessment = (typeof REFUND_WINDOW_ASSESSMENTS)[number];

export const REFUND_PROVIDER = "mercadopago" as const;

/** Phase 2 never records a sent refund. A later migration may add more values. */
export const REFUND_PROVIDER_STATUS_NOT_SENT = "not_sent" as const;

export type MercadoPagoRefundIntent = {
  provider: typeof REFUND_PROVIDER;
  mpPaymentId: string;
  dispatch: typeof REFUND_PROVIDER_STATUS_NOT_SENT;
};

export type RefundDispatchResult =
  | { ok: true; dispatched: false }
  | { ok: false; error: "provider_refund_not_enabled" };

const TRANSITIONS: Record<RefundRequestStatus, Partial<Record<RefundReviewAction, RefundRequestStatus>>> = {
  submitted: { start_review: "in_review", reject: "rejected" },
  in_review: { approve: "approved", reject: "rejected" },
  approved: {},
  rejected: {},
  withdrawn: {},
};

export const REFUND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function saoPauloDateIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Calendar date of an absolute instant in America/Sao_Paulo. */
export function saoPauloDateFromInstant(isoTimestamp: string): string | null {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return null;
  return saoPauloDateIso(date);
}

/**
 * Seven days measured from the payment instant.
 * Equal to the deadline stays inside. One millisecond past it does not.
 * The UTC calendar date of the timestamp is not the start of the window.
 */
export function refundWindowContainsInstant(paidAt: Date, now: Date): boolean {
  const paid = paidAt.getTime();
  const current = now.getTime();
  if (Number.isNaN(paid) || Number.isNaN(current) || paid > current) return false;
  return current - paid <= REFUND_WINDOW_MS;
}

export function assessRefundWindowFromInstant(paidAt: Date, now: Date): RefundWindowAssessment {
  if (Number.isNaN(paidAt.getTime()) || Number.isNaN(now.getTime())) return "unknown";
  if (paidAt.getTime() > now.getTime()) return "unknown";
  return refundWindowContainsInstant(paidAt, now) ? "within_window" : "outside_window";
}

export function addCalendarDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function assessRefundWindow(input: {
  paidOn: string | null;
  todayIso: string;
  windowDays: number;
}): RefundWindowAssessment {
  if (!input.paidOn) return "unknown";
  if (input.paidOn > input.todayIso) return "unknown";
  const deadline = addCalendarDays(input.paidOn, input.windowDays);
  return input.todayIso <= deadline ? "within_window" : "outside_window";
}

export function refundRequestFingerprint(input: {
  payerEmail: string;
  mpPaymentId: string;
  reason: RefundRequestReason;
  notes: string;
  intensiveUseDeclared: boolean;
  paidOn: string | null;
}): string {
  return [
    input.payerEmail.trim().toLowerCase(),
    input.mpPaymentId.trim(),
    input.reason,
    input.notes.trim(),
    input.intensiveUseDeclared ? "1" : "0",
    input.paidOn ?? "",
  ].join("\u001f");
}

export function decideRefundReview(input: {
  status: RefundRequestStatus;
  action: RefundReviewAction;
  windowAssessment: RefundWindowAssessment;
  resolutionNote: string;
  acknowledgeOutsideWindow: boolean;
}): { ok: true; nextStatus: RefundRequestStatus } | { ok: false; error: string } {
  const nextStatus = TRANSITIONS[input.status][input.action];
  if (!nextStatus) {
    return {
      ok: false,
      error: input.status === "approved" || input.status === "rejected" || input.status === "withdrawn"
        ? "refund_request_terminal"
        : "invalid_transition",
    };
  }
  if (input.action === "reject" && input.resolutionNote.trim().length < 3) {
    return { ok: false, error: "resolution_note_required" };
  }
  if (
    input.action === "approve" &&
    input.windowAssessment === "outside_window" &&
    !input.acknowledgeOutsideWindow
  ) {
    return { ok: false, error: "outside_window_unacknowledged" };
  }
  return { ok: true, nextStatus };
}

/** Future Mercado Pago refund call site. This phase returns the intent and does not perform I/O. */
export function planMercadoPagoRefund(mpPaymentId: string): MercadoPagoRefundIntent {
  return {
    provider: REFUND_PROVIDER,
    mpPaymentId,
    dispatch: REFUND_PROVIDER_STATUS_NOT_SENT,
  };
}

/** Hard stop until a later phase is explicitly allowed to call the provider. */
export function dispatchMercadoPagoRefund(): RefundDispatchResult {
  return { ok: false, error: "provider_refund_not_enabled" };
}

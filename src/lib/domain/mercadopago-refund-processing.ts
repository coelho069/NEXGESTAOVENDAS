import type {
  MercadoPagoRefundAdapter,
  NormalizedRefundResponse,
  PersistedCheckoutPayment,
  RefundAuditEvent,
  RefundProcessingRequest,
  UntrustedRefundCommand,
} from "@/lib/domain/mercadopago-refund";
import { refundIdempotencyKey, rejectUntrustedRefundCommand, validateRefundEligibility } from "@/lib/domain/mercadopago-refund";

export type RefundAttemptState = "processing" | "processing_simulated" | "failed" | "refunded";

export type RefundAttempt = {
  refundRequestId: string;
  paymentId: string;
  idempotencyKey: string;
  state: RefundAttemptState;
  providerRefundId: string | null;
  providerRefundStatus: "not_sent";
  financialEffect: boolean;
  failure: "timeout" | "provider_error" | null;
  refundRequestStatus: "approved";
};

export type RefundAttemptStore = {
  claim(input: {
    refundRequestId: string;
    paymentId: string;
    idempotencyKey: string;
  }): Promise<{ acquired: true; attempt: RefundAttempt } | { acquired: false; attempt: RefundAttempt | null; reason: "in_progress" | "duplicate_payment" }>;
  save(attempt: RefundAttempt): Promise<void>;
  findByRequestId(refundRequestId: string): Promise<RefundAttempt | null>;
};

export type RefundProcessingResult =
  | {
      ok: true;
      status: "processing_simulated" | "refunded";
      replayed: boolean;
      financialEffect: boolean;
      providerRefundId: string | null;
      providerRefundStatus: "not_sent";
      idempotencyKey: string;
      refundRequestStatus: "approved";
      audits: RefundAuditEvent[];
    }
  | {
      ok: false;
      error: string;
      financialEffect: false;
      providerRefundId: null;
      providerRefundStatus: "not_sent";
      idempotencyKey: string | null;
      audits: RefundAuditEvent[];
    };

export function createMemoryRefundAttemptStore(): RefundAttemptStore {
  const byRequest = new Map<string, RefundAttempt>();
  const byPayment = new Map<string, string>();
  let chain: Promise<void> = Promise.resolve();

  function exclusive<T>(work: () => T): Promise<T> {
    const run = chain.then(work);
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  return {
    claim(input) {
      return exclusive(() => {
        const existing = byRequest.get(input.refundRequestId);
        if (existing?.state === "processing") {
          return { acquired: false, attempt: existing, reason: "in_progress" as const };
        }
        const owner = byPayment.get(input.paymentId);
        if (owner && owner !== input.refundRequestId) {
          return { acquired: false, attempt: byRequest.get(owner) ?? null, reason: "duplicate_payment" as const };
        }
        if (existing) return { acquired: false, attempt: existing, reason: "in_progress" as const };
        const attempt: RefundAttempt = {
          refundRequestId: input.refundRequestId,
          paymentId: input.paymentId,
          idempotencyKey: input.idempotencyKey,
          state: "processing",
          providerRefundId: null,
          providerRefundStatus: "not_sent",
          financialEffect: false,
          failure: null,
          refundRequestStatus: "approved",
        };
        byRequest.set(input.refundRequestId, attempt);
        byPayment.set(input.paymentId, input.refundRequestId);
        return { acquired: true, attempt };
      });
    },
    save(attempt) {
      return exclusive(() => {
        byRequest.set(attempt.refundRequestId, attempt);
        byPayment.set(attempt.paymentId, attempt.refundRequestId);
      });
    },
    findByRequestId(refundRequestId) {
      return exclusive(() => byRequest.get(refundRequestId) ?? null);
    },
  };
}

function simulated(attempt: RefundAttempt, replayed: boolean, audits: RefundAuditEvent[]): RefundProcessingResult {
  return {
    ok: true,
    status: "processing_simulated",
    replayed,
    financialEffect: false,
    providerRefundId: null,
    providerRefundStatus: "not_sent",
    idempotencyKey: attempt.idempotencyKey,
    refundRequestStatus: "approved",
    audits,
  };
}

export async function processMercadoPagoRefund(input: {
  actorUserId: string | null;
  request: RefundProcessingRequest;
  payment: PersistedCheckoutPayment | null;
  untrusted?: UntrustedRefundCommand;
  adapter: MercadoPagoRefundAdapter;
  attempts: RefundAttemptStore;
  retry?: boolean;
}): Promise<RefundProcessingResult> {
  const audits: RefundAuditEvent[] = [];
  const eligibility = validateRefundEligibility({
    request: input.request,
    payment: input.payment,
    actorUserId: input.actorUserId,
  });
  const eligibleAmount = eligibility.ok ? eligibility.amount : input.payment?.amount ?? null;
  const untrustedError = rejectUntrustedRefundCommand(input.untrusted, eligibleAmount);
  if (untrustedError) {
    return {
      ok: false,
      error: untrustedError,
      financialEffect: false,
      providerRefundId: null,
      providerRefundStatus: "not_sent",
      idempotencyKey: null,
      audits,
    };
  }
  if (!eligibility.ok || !input.payment) {
    return {
      ok: false,
      error: eligibility.ok ? "payment_not_found" : eligibility.error,
      financialEffect: false,
      providerRefundId: null,
      providerRefundStatus: "not_sent",
      idempotencyKey: eligibility.ok ? eligibility.idempotencyKey : null,
      audits,
    };
  }

  const idempotencyKey = refundIdempotencyKey(input.request.id);
  const claim = await input.attempts.claim({
    refundRequestId: input.request.id,
    paymentId: input.payment.mpPaymentId,
    idempotencyKey,
  });

  if (!claim.acquired) {
    if (claim.reason === "duplicate_payment") {
      return {
        ok: false,
        error: "duplicate_payment_refund",
        financialEffect: false,
        providerRefundId: null,
        providerRefundStatus: "not_sent",
        idempotencyKey,
        audits,
      };
    }
    const existing = claim.attempt;
    if (!existing) {
      return {
        ok: false,
        error: "processing_in_progress",
        financialEffect: false,
        providerRefundId: null,
        providerRefundStatus: "not_sent",
        idempotencyKey,
        audits,
      };
    }
    if (existing.state === "processing") {
      return {
        ok: false,
        error: "processing_in_progress",
        financialEffect: false,
        providerRefundId: null,
        providerRefundStatus: "not_sent",
        idempotencyKey: existing.idempotencyKey,
        audits,
      };
    }
    if (existing.state === "processing_simulated") return simulated(existing, true, audits);
    if (existing.state === "refunded") {
      return {
        ok: true,
        status: "refunded",
        replayed: true,
        financialEffect: existing.financialEffect,
        providerRefundId: existing.providerRefundId,
        providerRefundStatus: "not_sent",
        idempotencyKey: existing.idempotencyKey,
        refundRequestStatus: "approved",
        audits,
      };
    }
    if (!input.retry) {
      return {
        ok: false,
        error: existing.failure === "timeout" ? "provider_timeout" : "provider_error",
        financialEffect: false,
        providerRefundId: null,
        providerRefundStatus: "not_sent",
        idempotencyKey: existing.idempotencyKey,
        audits,
      };
    }
    existing.state = "processing";
    existing.failure = null;
    await input.attempts.save(existing);
  }

  const attempt = claim.acquired ? claim.attempt : (await input.attempts.findByRequestId(input.request.id));
  if (!attempt || attempt.idempotencyKey !== idempotencyKey) {
    return {
      ok: false,
      error: "idempotency_mismatch",
      financialEffect: false,
      providerRefundId: null,
      providerRefundStatus: "not_sent",
      idempotencyKey,
      audits,
    };
  }

  audits.push({
    event: "refund_processing_started",
    refundRequestId: input.request.id,
    idempotencyKey,
    outcome: "processing",
  });

  const built = input.adapter.buildRefundRequest(eligibility, input.payment);
  let normalized: NormalizedRefundResponse;
  try {
    const raw = await input.adapter.executeRefund(built);
    normalized = input.adapter.normalizeRefundResponse(raw) ?? raw;
  } catch (error) {
    const timeout = error instanceof Error && /timeout/i.test(error.message);
    attempt.state = "failed";
    attempt.failure = timeout ? "timeout" : "provider_error";
    attempt.financialEffect = false;
    attempt.providerRefundId = null;
    attempt.providerRefundStatus = "not_sent";
    await input.attempts.save(attempt);
    audits.push({
      event: "refund_processing_failed",
      refundRequestId: input.request.id,
      idempotencyKey,
      outcome: "failed",
    });
    return {
      ok: false,
      error: timeout ? "provider_timeout" : "provider_error",
      financialEffect: false,
      providerRefundId: null,
      providerRefundStatus: "not_sent",
      idempotencyKey,
      audits,
    };
  }

  if (normalized.mode === "dry_run") {
    attempt.state = "processing_simulated";
    attempt.financialEffect = false;
    attempt.providerRefundId = null;
    attempt.providerRefundStatus = "not_sent";
    attempt.failure = null;
    await input.attempts.save(attempt);
    audits.push({
      event: "refund_processing_dry_run",
      refundRequestId: input.request.id,
      idempotencyKey,
      outcome: "processing_simulated",
    });
    return simulated(attempt, false, audits);
  }

  if (
    normalized.mode === "provider_confirmed" &&
    normalized.financialEffect === true &&
    normalized.status === "refunded" &&
    typeof normalized.providerRefundId === "string" &&
    normalized.providerRefundId.length > 0
  ) {
    attempt.state = "refunded";
    attempt.financialEffect = true;
    attempt.providerRefundId = normalized.providerRefundId;
    attempt.providerRefundStatus = "not_sent";
    attempt.failure = null;
    await input.attempts.save(attempt);
    audits.push({
      event: "refund_provider_confirmed",
      refundRequestId: input.request.id,
      idempotencyKey,
      outcome: "refunded",
    });
    return {
      ok: true,
      status: "refunded",
      replayed: false,
      financialEffect: true,
      providerRefundId: normalized.providerRefundId,
      providerRefundStatus: "not_sent",
      idempotencyKey,
      refundRequestStatus: "approved",
      audits,
    };
  }

  attempt.state = "failed";
  attempt.failure = normalized.failure === "timeout" ? "timeout" : "provider_error";
  attempt.financialEffect = false;
  attempt.providerRefundId = null;
  attempt.providerRefundStatus = "not_sent";
  await input.attempts.save(attempt);
  audits.push({
    event: "refund_processing_failed",
    refundRequestId: input.request.id,
    idempotencyKey,
    outcome: "failed",
  });
  return {
    ok: false,
    error: attempt.failure === "timeout" ? "provider_timeout" : "provider_error",
    financialEffect: false,
    providerRefundId: null,
    providerRefundStatus: "not_sent",
    idempotencyKey,
    audits,
  };
}

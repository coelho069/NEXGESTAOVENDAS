import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { refundSandboxProcessingEnabled } from "@/lib/domain/refund-sandbox-mode";
import {
  SANDBOX_PROVIDER_REFUND_ID,
  createSandboxRefundProvider,
  processSandboxMercadoPagoRefund,
  type SandboxProcessingResult,
  type SandboxProviderResponse,
  type SandboxRefundProvider,
  type SandboxRefundStore,
  type SandboxScenario,
} from "@/lib/domain/mercadopago-refund-sandbox";
import {
  isExactRefundMoney,
  persistedRefundAmount,
  refundIdempotencyKey,
  validateRefundEligibility,
} from "@/lib/domain/mercadopago-refund";
import { money, toMoneyString } from "@/lib/money";
import { claimPersistedRefundProcessing, failPersistedRefundProcessing } from "@/lib/server/refund-processing-claim";
import {
  completePersistedSandboxRefund,
  dispatchPersistedSandboxRefund,
  failPersistedSandboxRefund,
  retryPersistedSandboxRefund,
  timeoutPersistedSandboxRefund,
} from "@/lib/server/refund-sandbox-settlement";

type AdminClient = SupabaseClient<Database>;

type Lookup = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message?: string } | null }>;
      };
    };
  };
};

const BLOCKED_STATUSES = new Set(["submitted", "requested", "in_review", "rejected", "withdrawn"]);

export type AdminSandboxRefundBody = {
  ok: boolean;
  error?: string;
  status?: string;
  provider_refund_status?: string | null;
  provider_refund_id?: string | null;
  processing_state?: string | null;
  processing_finished_at?: string | null;
  financial_effect: false;
  retryable: boolean;
  replayed?: boolean;
  amount?: string | null;
};

export type AdminSandboxRefundOutcome = {
  httpStatus: number;
  body: AdminSandboxRefundBody;
};

function loose(admin: AdminClient): Lookup {
  return admin as unknown as Lookup;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Snapshot money only. plan and contracted amounts are never read. */
function readSnapshotAmount(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (isExactRefundMoney(trimmed) && money(trimmed).gt(0)) return trimmed;
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const text = toMoneyString(money(value));
    if (isExactRefundMoney(text) && money(text).eq(value) && money(text).gt(0)) return text;
  }
  return null;
}

function httpStatusFor(error: string | undefined, refunded: boolean): number {
  if (refunded) return 200;
  switch (error) {
    case "provider_timeout":
    case "provider_unavailable":
    case "refund_not_allowed":
      return 200;
    case "not_found":
    case "payment_not_found":
      return 404;
    case "not_owner":
    case "payment_not_owned":
    case "sandbox_disabled":
      return 403;
    case "paid_amount_unavailable":
    case "invalid_currency":
    case "invalid_amount":
    case "unpaid":
      return 422;
    case "not_approved":
    case "already_refunded":
    case "not_retryable":
    case "retry_exhausted":
    case "processing_in_progress":
    case "duplicate_payment_refund":
      return 409;
    case "database":
    case "unavailable":
      return 503;
    default:
      return 400;
  }
}

function outcomeFrom(
  result: SandboxProcessingResult,
  amount: string | null,
  replayed = false
): AdminSandboxRefundOutcome {
  const confirmed =
    result.ok === true &&
    result.status === "refunded" &&
    result.providerRefundStatus === "completed" &&
    typeof result.providerRefundId === "string" &&
    result.providerRefundId.length > 0 &&
    result.financialEffect === false;
  return {
    httpStatus: confirmed ? 200 : httpStatusFor(result.error, false),
    body: {
      ok: confirmed,
      error: confirmed ? undefined : result.error,
      status: confirmed ? "refunded" : result.refundRequestStatus,
      provider_refund_status: confirmed ? "completed" : result.providerRefundStatus,
      provider_refund_id: confirmed ? result.providerRefundId : null,
      processing_state: result.processingState,
      processing_finished_at: confirmed ? result.processingFinishedAt : null,
      financial_effect: false,
      retryable: confirmed ? false : result.retryable,
      replayed: confirmed ? replayed || result.replayed === true : false,
      amount,
    },
  };
}

function stopped(error: string, status: string): SandboxProcessingResult {
  return {
    ok: false,
    error,
    financialEffect: false,
    providerRefundId: null,
    providerRefundStatus: "not_sent",
    idempotencyKey: null,
    refundRequestStatus: status as SandboxProcessingResult["refundRequestStatus"],
    processingState: null,
    processingFinishedAt: null,
    attempts: 0,
    retryable: false,
    errorClass: null,
    audits: [],
  };
}

async function maybeOne(
  admin: AdminClient,
  table: string,
  column: string,
  value: string,
  columns: string
): Promise<Record<string, unknown> | null> {
  const result = await loose(admin).from(table).select(columns).eq(column, value).maybeSingle();
  if (result.error) throw new Error("refund_sandbox_lookup_failed");
  return result.data;
}

function createPersistedSandboxStore(admin: AdminClient): SandboxRefundStore {
  let actorUserId: string | null = null;
  let lockedAmount: string | null = null;

  return {
    async inspect() {
      return null;
    },
    async begin(input) {
      actorUserId = input.actorUserId;
      const request = input.request;
      const payment = input.payment;
      if (!input.actorUserId) {
        return { action: "stop", result: stopped("unauthenticated", request.status) };
      }
      if (BLOCKED_STATUSES.has(request.status)) {
        return { action: "stop", result: stopped("not_approved", request.status) };
      }
      if (request.status === "refunded") {
        return { action: "stop", result: stopped("already_refunded", "refunded") };
      }
      if (!payment) {
        return { action: "stop", result: stopped("payment_not_found", request.status) };
      }
      if (payment.ownerUserId !== input.actorUserId || request.ownerUserId !== input.actorUserId) {
        return { action: "stop", result: stopped("not_owner", request.status) };
      }
      if (payment.mpPaymentId !== request.mpPaymentId) {
        return { action: "stop", result: stopped("payment_not_owned", request.status) };
      }
      const priced = persistedRefundAmount({
        transactionAmount: payment.amount,
        transactionCurrency: payment.currency,
      });
      if (!priced.ok) {
        return { action: "stop", result: stopped(priced.error, request.status) };
      }
      if (!payment.paidAt || Number.isNaN(Date.parse(payment.paidAt))) {
        return { action: "stop", result: stopped("paid_amount_unavailable", request.status) };
      }
      lockedAmount = priced.amount;

      if (input.retry === true) {
        const retried = await retryPersistedSandboxRefund({
          admin,
          refundRequestId: request.id,
          actorUserId: input.actorUserId,
        });
        if (retried.ok !== true) {
          return {
            action: "stop",
            result: stopped(typeof retried.error === "string" ? retried.error : "not_retryable", request.status),
          };
        }
        const key = typeof retried.idempotency_key === "string" ? retried.idempotency_key : refundIdempotencyKey(request.id);
        return {
          action: "execute",
          command: { idempotencyKey: key, mpPaymentId: payment.mpPaymentId, amount: priced.amount, currency: "BRL" },
        };
      }

      if (request.status !== "approved") {
        return { action: "stop", result: stopped("not_approved", request.status) };
      }
      const eligibility = validateRefundEligibility({
        actorUserId: input.actorUserId,
        request: {
          id: request.id,
          status: "approved",
          mpPaymentId: request.mpPaymentId,
          ownerUserId: request.ownerUserId,
        },
        payment,
      });
      if (!eligibility.ok) {
        return { action: "stop", result: stopped(eligibility.error, "approved") };
      }

      const claim = await claimPersistedRefundProcessing({ admin, refundRequestId: request.id });
      if (!claim.acquired || !claim.idempotencyKey) {
        const reason = claim.reason === "duplicate_payment" ? "duplicate_payment_refund" : claim.reason === "in_progress" ? "processing_in_progress" : claim.reason === "not_found" ? "not_found" : "not_approved";
        return { action: "stop", result: stopped(reason, "approved") };
      }

      const dispatched = await dispatchPersistedSandboxRefund({
        admin,
        refundRequestId: request.id,
        actorUserId: input.actorUserId,
      });
      if (dispatched.ok !== true) {
        await failPersistedRefundProcessing({
          admin,
          refundRequestId: request.id,
          error: typeof dispatched.error === "string" ? dispatched.error : "dispatch_failed",
        });
        return {
          action: "stop",
          result: stopped(typeof dispatched.error === "string" ? dispatched.error : "unavailable", "approved"),
        };
      }

      return {
        action: "execute",
        command: {
          idempotencyKey: claim.idempotencyKey,
          mpPaymentId: payment.mpPaymentId,
          amount: priced.amount,
          currency: "BRL",
        },
      };
    },
    async finish(input) {
      const actor = actorUserId;
      const amount = lockedAmount;
      if (!actor || !amount) return stopped("unavailable", "processing");
      return persistSandboxResponse(admin, input.refundRequestId, actor, amount, input.response);
    },
  };
}

async function persistSandboxResponse(
  admin: AdminClient,
  refundRequestId: string,
  actorUserId: string,
  lockedAmount: string,
  response: SandboxProviderResponse
): Promise<SandboxProcessingResult> {
  if (response.kind === "timeout") {
    const recorded = await timeoutPersistedSandboxRefund({ admin, refundRequestId, actorUserId });
    if (recorded.ok !== true || recorded.financial_effect !== false) {
      return stopped(typeof recorded.error === "string" ? recorded.error : "unavailable", "processing");
    }
    return {
      ok: false,
      error: "provider_timeout",
      financialEffect: false,
      providerRefundId: null,
      providerRefundStatus: "processing",
      idempotencyKey: typeof recorded.idempotency_key === "string" ? recorded.idempotency_key : null,
      refundRequestStatus: "processing",
      processingState: "unknown",
      processingFinishedAt: null,
      attempts: typeof recorded.processing_attempts === "number" ? recorded.processing_attempts : 0,
      retryable: true,
      errorClass: "timeout",
      audits: [],
    };
  }

  if (response.kind === "temporary_error" || response.kind === "permanent_error") {
    const errorClass = response.kind === "temporary_error" ? "temporary" : "permanent";
    const recorded = await failPersistedSandboxRefund({
      admin,
      refundRequestId,
      actorUserId,
      error: response.code,
      errorClass,
    });
    if (recorded.ok !== true || recorded.financial_effect !== false) {
      return stopped(typeof recorded.error === "string" ? recorded.error : "unavailable", "processing");
    }
    return {
      ok: false,
      error: response.code,
      financialEffect: false,
      providerRefundId: null,
      providerRefundStatus: "failed",
      idempotencyKey: typeof recorded.idempotency_key === "string" ? recorded.idempotency_key : null,
      refundRequestStatus: "processing",
      processingState: "failed",
      processingFinishedAt: null,
      attempts: typeof recorded.processing_attempts === "number" ? recorded.processing_attempts : 0,
      retryable: errorClass === "temporary",
      errorClass,
      audits: [],
    };
  }

  if (response.currency !== "BRL" || response.amount !== lockedAmount) {
    await failPersistedSandboxRefund({
      admin,
      refundRequestId,
      actorUserId,
      error: "snapshot_amount_mismatch",
      errorClass: "permanent",
    });
    return stopped("snapshot_amount_mismatch", "processing");
  }

  const recorded = await completePersistedSandboxRefund({
    admin,
    refundRequestId,
    actorUserId,
    providerRefundId: response.providerRefundId,
    amount: lockedAmount,
    currency: "BRL",
  });
  if (recorded.ok !== true || recorded.status !== "refunded" || recorded.financial_effect !== false) {
    return stopped(typeof recorded.error === "string" ? recorded.error : "unavailable", "processing");
  }
  const providerRefundId = typeof recorded.provider_refund_id === "string" ? recorded.provider_refund_id : null;
  if (!providerRefundId) return stopped("untrusted_provider_refund_id", "processing");
  return {
    ok: true,
    status: "refunded",
    replayed: recorded.replay === true,
    financialEffect: false,
    providerRefundId,
    providerRefundStatus: "completed",
    idempotencyKey: typeof recorded.idempotency_key === "string" ? recorded.idempotency_key : null,
    refundRequestStatus: "refunded",
    processingState: "completed",
    processingFinishedAt: typeof recorded.processing_finished_at === "string" ? recorded.processing_finished_at : null,
    attempts: typeof recorded.processing_attempts === "number" ? recorded.processing_attempts : 0,
    retryable: false,
    errorClass: null,
    audits: [],
  };
}

export function normalizeAdminSandboxScenario(scenario: string): SandboxScenario {
  if (scenario === "duplicate") return "duplicate_response";
  if (
    scenario === "success" ||
    scenario === "temporary_error" ||
    scenario === "permanent_error" ||
    scenario === "timeout" ||
    scenario === "duplicate_response"
  ) {
    return scenario;
  }
  return "success";
}

/**
 * Platform-admin sandbox settlement. The caller has already authenticated the admin.
 * Payment, customer, snapshot, and amount are loaded here. The browser cannot price or confirm the refund.
 * The provider is the in-memory sandbox. This function does not call Mercado Pago or Stripe.
 */
export async function processAdminSandboxRefund(input: {
  admin: AdminClient;
  refundRequestId: string;
  scenario: SandboxScenario;
  retry?: boolean;
  env?: Record<string, string | undefined>;
  provider?: SandboxRefundProvider;
}): Promise<AdminSandboxRefundOutcome> {
  if (!refundSandboxProcessingEnabled(input.env ?? process.env)) {
    return {
      httpStatus: 403,
      body: { ok: false, error: "sandbox_disabled", financial_effect: false, retryable: false },
    };
  }

  const requestRow = await maybeOne(
    input.admin,
    "refund_requests",
    "id",
    input.refundRequestId,
    "id, status, mp_payment_id, provider, provider_refund_status, checkout_session_id, requester_user_id, processing_state, provider_refund_id, processing_finished_at, financial_effect"
  );
  if (!requestRow) {
    return outcomeFrom(stopped("not_found", "approved"), null);
  }
  if (requestRow.financial_effect === true) {
    return outcomeFrom(stopped("financial_effect_refused", asText(requestRow.status) ?? "approved"), null);
  }

  const status = asText(requestRow.status) ?? "approved";
  const mpPaymentId = asText(requestRow.mp_payment_id) ?? "";
  const providerName = asText(requestRow.provider);
  if (providerName !== "mercadopago") {
    return outcomeFrom(stopped("not_approved", status), null);
  }

  if (
    status === "refunded" &&
    requestRow.provider_refund_status === "completed" &&
    typeof requestRow.provider_refund_id === "string" &&
    SANDBOX_PROVIDER_REFUND_ID.test(requestRow.provider_refund_id)
  ) {
    return {
      httpStatus: 200,
      body: {
        ok: true,
        status: "refunded",
        provider_refund_status: "completed",
        provider_refund_id: requestRow.provider_refund_id,
        processing_state: "completed",
        processing_finished_at: asText(requestRow.processing_finished_at),
        financial_effect: false,
        retryable: false,
        replayed: true,
        amount: null,
      },
    };
  }

  const paymentRow = mpPaymentId
    ? await maybeOne(
        input.admin,
        "checkout_sessions",
        "mp_payment_id",
        mpPaymentId,
        "id, mp_payment_id, onboarding_user_id, transaction_amount, transaction_currency, transaction_paid_at, mp_payment_status"
      )
    : null;
  const linkedId = asText(requestRow.checkout_session_id);

  if (!paymentRow) {
    return outcomeFrom(stopped("payment_not_found", status), null);
  }
  if (!linkedId || asText(paymentRow.id) !== linkedId) {
    return outcomeFrom(stopped("not_owner", status), null);
  }

  const customerId = asText(paymentRow.onboarding_user_id);
  const requesterId = asText(requestRow.requester_user_id);
  if (!customerId || (requesterId !== null && requesterId !== customerId)) {
    return outcomeFrom(stopped("not_owner", status), null);
  }
  const paymentOwnerId = customerId;
  if (asText(paymentRow.mp_payment_id) !== mpPaymentId) {
    return outcomeFrom(stopped("payment_not_owned", status), null);
  }

  const amount = readSnapshotAmount(paymentRow.transaction_amount);
  const currency = paymentRow.transaction_currency === "BRL" ? "BRL" : asText(paymentRow.transaction_currency);
  const paidAt = asText(paymentRow.transaction_paid_at);
  const paymentStatus = asText(paymentRow.mp_payment_status) ?? "";

  const provider = input.provider ?? createSandboxRefundProvider(input.scenario);
  const result = await processSandboxMercadoPagoRefund({
    actorUserId: customerId,
    request: {
      id: input.refundRequestId,
      status: status as SandboxProcessingResult["refundRequestStatus"],
      mpPaymentId,
      ownerUserId: customerId,
    },
    payment: {
      mpPaymentId,
      ownerUserId: paymentOwnerId,
      currency,
      amount,
      provider: "mercadopago",
      status: paymentStatus,
      paidAt,
    },
    provider,
    store: createPersistedSandboxStore(input.admin),
    retry: input.retry === true,
  });

  if (result.financialEffect !== false) {
    return outcomeFrom(stopped("financial_effect_refused", status), amount);
  }
  return outcomeFrom(result, amount);
}

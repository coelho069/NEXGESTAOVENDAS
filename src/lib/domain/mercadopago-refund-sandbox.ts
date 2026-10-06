import type { RefundAuditEvent } from "@/lib/domain/mercadopago-refund";
import {
  compareExactMoney,
  persistedRefundAmount,
  refundIdempotencyKey,
  rejectUntrustedRefundCommand,
  validateRefundEligibility,
  type PersistedCheckoutPayment,
  type UntrustedRefundCommand,
} from "@/lib/domain/mercadopago-refund";
import type { RefundRequestStatus } from "@/lib/domain/refund-request";

/**
 * Sandbox refund settlement. The provider is an in-process mock.
 * financialEffect is always false: this path never moves money.
 * submitted = requested, in_review = under_review, withdrawn = cancelled.
 */

export const SANDBOX_FINANCIAL_EFFECT = false as const;
export const SANDBOX_MAX_ATTEMPTS = 5;
export const SANDBOX_PROVIDER_REFUND_ID = /^sandbox_[a-f0-9]{32}$/;

const SECRET_TEXT = /access_token|client_secret|authorization|cookie|bearer\s/i;

export const SANDBOX_SCENARIOS = [
  "success",
  "temporary_error",
  "permanent_error",
  "timeout",
  "duplicate_response",
] as const;

export type SandboxScenario = (typeof SANDBOX_SCENARIOS)[number];

export type SandboxRefundStatus = RefundRequestStatus | "processing" | "refunded";

export type SandboxProviderRefundStatus = "not_sent" | "processing" | "completed" | "failed";

export type SandboxProcessingState = "processing" | "simulated" | "failed" | "unknown" | "completed";

export type SandboxErrorClass = "temporary" | "permanent" | "timeout";

export type SandboxRefundRequest = {
  id: string;
  status: SandboxRefundStatus;
  mpPaymentId: string;
  ownerUserId: string;
};

export type SandboxPayment = PersistedCheckoutPayment & {
  paidAt: string | null;
};

export type SandboxRefundCommand = {
  idempotencyKey: string;
  mpPaymentId: string;
  amount: string;
  currency: "BRL";
};

export type SandboxProviderResponse =
  | {
      kind: "confirmed";
      providerRefundId: string;
      amount: string;
      currency: string;
      duplicate: boolean;
    }
  | { kind: "temporary_error"; code: "provider_unavailable" }
  | { kind: "permanent_error"; code: "refund_not_allowed" }
  | { kind: "timeout" };

export type SandboxRefundProvider = {
  scenario: SandboxScenario;
  execute(command: SandboxRefundCommand): SandboxProviderResponse | Promise<SandboxProviderResponse>;
  logicalOperationCount(): number;
  callCount(): number;
  setScenario(scenario: SandboxScenario): void;
};

export type SandboxRefundRecord = {
  id: string;
  status: SandboxRefundStatus;
  ownerUserId: string;
  mpPaymentId: string;
  idempotencyKey: string | null;
  processingState: SandboxProcessingState | null;
  processingAttempts: number;
  providerRefundStatus: SandboxProviderRefundStatus;
  providerRefundId: string | null;
  lastError: string | null;
  errorClass: SandboxErrorClass | null;
  processingStartedAt: string | null;
  processingFinishedAt: string | null;
  financialEffect: false;
  lockedAmount: string | null;
};

export type SandboxProcessingResult = {
  ok: boolean;
  status?: "refunded";
  replayed?: boolean;
  error?: string;
  financialEffect: false;
  providerRefundId: string | null;
  providerRefundStatus: SandboxProviderRefundStatus;
  idempotencyKey: string | null;
  refundRequestStatus: SandboxRefundStatus;
  processingState: SandboxProcessingState | null;
  processingFinishedAt: string | null;
  attempts: number;
  retryable: boolean;
  errorClass: SandboxErrorClass | null;
  audits: RefundAuditEvent[];
};

type StoredRefund = SandboxRefundRecord;

type BeginDecision =
  | { action: "execute"; command: SandboxRefundCommand }
  | { action: "stop"; result: SandboxProcessingResult };

export function redactRefundError(value: string): string {
  const trimmed = value.slice(0, 200);
  if (SECRET_TEXT.test(trimmed)) return "redacted";
  return trimmed;
}

export function sandboxRefundId(idempotencyKey: string): string {
  const parts = [0, 1, 2, 3].map((salt) => {
    let hash = 2166136261 ^ salt;
    for (let index = 0; index < idempotencyKey.length; index += 1) {
      hash ^= idempotencyKey.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  });
  return `sandbox_${parts.join("")}`;
}

export function createSandboxRefundProvider(scenario: SandboxScenario): SandboxRefundProvider {
  const operations = new Map<string, { providerRefundId: string; amount: string; currency: "BRL" }>();
  let logicalOperations = 0;
  let calls = 0;
  let current = scenario;

  function confirm(command: SandboxRefundCommand): SandboxProviderResponse {
    const existing = operations.get(command.idempotencyKey);
    if (existing) {
      return { kind: "confirmed", ...existing, duplicate: true };
    }
    logicalOperations += 1;
    const created = {
      providerRefundId: sandboxRefundId(command.idempotencyKey),
      amount: command.amount,
      currency: "BRL" as const,
    };
    operations.set(command.idempotencyKey, created);
    return { kind: "confirmed", ...created, duplicate: false };
  }

  return {
    get scenario() {
      return current;
    },
    setScenario(next) {
      current = next;
    },
    logicalOperationCount() {
      return logicalOperations;
    },
    callCount() {
      return calls;
    },
    execute(command) {
      calls += 1;
      const existing = operations.get(command.idempotencyKey);
      if (existing) return { kind: "confirmed", ...existing, currency: "BRL", duplicate: true };
      if (current === "temporary_error") return { kind: "temporary_error", code: "provider_unavailable" };
      if (current === "permanent_error") return { kind: "permanent_error", code: "refund_not_allowed" };
      if (current === "timeout") return { kind: "timeout" };
      return confirm(command);
    },
  };
}

function copyRecord(row: StoredRefund): SandboxRefundRecord {
  return { ...row };
}

function stopped(
  partial: Partial<SandboxProcessingResult> & Pick<SandboxProcessingResult, "error" | "refundRequestStatus">
): SandboxProcessingResult {
  return {
    ok: false,
    providerRefundId: null,
    providerRefundStatus: "not_sent",
    idempotencyKey: null,
    processingState: null,
    processingFinishedAt: null,
    attempts: 0,
    retryable: false,
    errorClass: null,
    audits: [],
    ...partial,
    financialEffect: SANDBOX_FINANCIAL_EFFECT,
  };
}

function succeeded(row: StoredRefund, replayed: boolean): SandboxProcessingResult {
  return {
    ok: true,
    status: "refunded",
    replayed,
    financialEffect: SANDBOX_FINANCIAL_EFFECT,
    providerRefundId: row.providerRefundId,
    providerRefundStatus: "completed",
    idempotencyKey: row.idempotencyKey,
    refundRequestStatus: "refunded",
    processingState: "completed",
    processingFinishedAt: row.processingFinishedAt,
    attempts: row.processingAttempts,
    retryable: false,
    errorClass: null,
    audits: [],
  };
}

function fromRow(row: StoredRefund, error: string, retryable: boolean): SandboxProcessingResult {
  return {
    ok: false,
    error,
    financialEffect: SANDBOX_FINANCIAL_EFFECT,
    providerRefundId: null,
    providerRefundStatus: row.providerRefundStatus,
    idempotencyKey: row.idempotencyKey,
    refundRequestStatus: row.status,
    processingState: row.processingState,
    processingFinishedAt: row.processingFinishedAt,
    attempts: row.processingAttempts,
    retryable,
    errorClass: row.errorClass,
    audits: [],
  };
}

function paidAtReady(value: string | null): boolean {
  if (!value) return false;
  return !Number.isNaN(Date.parse(value));
}

export type SandboxRefundStore = {
  begin(input: {
    actorUserId: string | null;
    request: SandboxRefundRequest;
    payment: SandboxPayment | null;
    retry?: boolean;
  }): Promise<BeginDecision>;
  finish(input: { refundRequestId: string; response: SandboxProviderResponse }): Promise<SandboxProcessingResult>;
  inspect(refundRequestId: string): Promise<SandboxRefundRecord | null>;
};

export function createMemorySandboxRefundStore(): SandboxRefundStore {
  const rows = new Map<string, StoredRefund>();
  const claimByPayment = new Map<string, string>();
  let chain: Promise<void> = Promise.resolve();

  function exclusive<T>(work: () => T): Promise<T> {
    const run = chain.then(work);
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  function claimPayment(row: StoredRefund) {
    claimByPayment.set(row.mpPaymentId, row.id);
  }

  return {
    inspect(refundRequestId) {
      return exclusive(() => {
        const row = rows.get(refundRequestId);
        return row ? copyRecord(row) : null;
      });
    },
    begin(input) {
      return exclusive(() => decideBegin(rows, claimByPayment, claimPayment, input));
    },
    finish(input) {
      return exclusive(() => decideFinish(rows, input));
    },
  };
}

function decideBegin(
  rows: Map<string, StoredRefund>,
  claimByPayment: Map<string, string>,
  claimPayment: (row: StoredRefund) => void,
  input: {
    actorUserId: string | null;
    request: SandboxRefundRequest;
    payment: SandboxPayment | null;
    retry?: boolean;
  }
): BeginDecision {
  const request = input.request;
  const existing = rows.get(request.id);
  if (existing?.status === "refunded" || existing?.processingState === "completed") {
    return { action: "stop", result: succeeded(existing, true) };
  }
  if (!input.actorUserId) {
    return { action: "stop", result: stopped({ error: "unauthenticated", refundRequestStatus: request.status }) };
  }
  if (
    request.status === "submitted" ||
    request.status === "in_review" ||
    request.status === "rejected" ||
    request.status === "withdrawn"
  ) {
    return { action: "stop", result: stopped({ error: "not_approved", refundRequestStatus: request.status }) };
  }
  if (request.status === "refunded" && !existing) {
    return { action: "stop", result: stopped({ error: "already_refunded", refundRequestStatus: "refunded" }) };
  }
  if (request.status === "processing" && !existing) {
    return { action: "stop", result: stopped({ error: "not_approved", refundRequestStatus: "processing" }) };
  }

  if (!existing) {
    return startClaim(rows, claimByPayment, claimPayment, input);
  }

  if (existing.ownerUserId !== input.actorUserId || input.payment?.ownerUserId !== input.actorUserId) {
    return { action: "stop", result: fromRow(existing, "not_owner", false) };
  }
  if (!input.payment || existing.mpPaymentId !== input.payment.mpPaymentId || request.mpPaymentId !== existing.mpPaymentId) {
    return { action: "stop", result: fromRow(existing, "payment_not_owned", false) };
  }

  if (existing.processingState === "processing") {
    return { action: "stop", result: fromRow(existing, "processing_in_progress", false) };
  }
  if (!input.payment) {
    return { action: "stop", result: fromRow(existing, "payment_not_found", false) };
  }
  if (existing.processingState === "unknown") {
    if (input.retry !== true) return { action: "stop", result: fromRow(existing, "provider_timeout", true) };
    return reopen(existing, input.payment);
  }
  if (existing.processingState === "failed") {
    if (existing.errorClass !== "temporary") {
      return { action: "stop", result: fromRow(existing, "not_retryable", false) };
    }
    if (input.retry !== true) return { action: "stop", result: fromRow(existing, "provider_unavailable", true) };
    return reopen(existing, input.payment);
  }
  return { action: "stop", result: fromRow(existing, "not_approved", false) };
}

function startClaim(
  rows: Map<string, StoredRefund>,
  claimByPayment: Map<string, string>,
  claimPayment: (row: StoredRefund) => void,
  input: {
    actorUserId: string | null;
    request: SandboxRefundRequest;
    payment: SandboxPayment | null;
  }
): BeginDecision {
  const request = input.request;
  const payment = input.payment;
  if (request.status !== "approved") {
    return { action: "stop", result: stopped({ error: "not_approved", refundRequestStatus: request.status }) };
  }
  const eligibility = validateRefundEligibility({
    actorUserId: input.actorUserId,
    request: { id: request.id, status: "approved", mpPaymentId: request.mpPaymentId, ownerUserId: request.ownerUserId },
    payment,
  });
  if (!eligibility.ok || !payment) {
    return {
      action: "stop",
      result: stopped({
        error: eligibility.ok ? "payment_not_found" : eligibility.error,
        refundRequestStatus: "approved",
      }),
    };
  }
  const priced = persistedRefundAmount({
    transactionAmount: payment.amount,
    transactionCurrency: payment.currency,
  });
  if (!priced.ok) {
    return { action: "stop", result: stopped({ error: priced.error, refundRequestStatus: "approved" }) };
  }
  if (!paidAtReady(payment.paidAt)) {
    return { action: "stop", result: stopped({ error: "paid_amount_unavailable", refundRequestStatus: "approved" }) };
  }
  const otherClaim = claimByPayment.get(payment.mpPaymentId);
  if (otherClaim && otherClaim !== request.id) {
    return { action: "stop", result: stopped({ error: "duplicate_payment_refund", refundRequestStatus: "approved" }) };
  }

  const now = new Date().toISOString();
  const row: StoredRefund = {
    id: request.id,
    status: "processing",
    ownerUserId: request.ownerUserId,
    mpPaymentId: payment.mpPaymentId,
    idempotencyKey: refundIdempotencyKey(request.id),
    processingState: "processing",
    processingAttempts: 1,
    providerRefundStatus: "processing",
    providerRefundId: null,
    lastError: null,
    errorClass: null,
    processingStartedAt: now,
    processingFinishedAt: null,
    financialEffect: SANDBOX_FINANCIAL_EFFECT,
    lockedAmount: priced.amount,
  };
  rows.set(row.id, row);
  claimPayment(row);
  return {
    action: "execute",
    command: {
      idempotencyKey: row.idempotencyKey ?? refundIdempotencyKey(request.id),
      mpPaymentId: row.mpPaymentId,
      amount: priced.amount,
      currency: "BRL",
    },
  };
}

function reopen(row: StoredRefund, payment: SandboxPayment): BeginDecision {
  if (row.processingAttempts >= SANDBOX_MAX_ATTEMPTS) {
    return { action: "stop", result: fromRow(row, "retry_exhausted", false) };
  }
  if (!row.lockedAmount || payment.amount !== row.lockedAmount || payment.currency !== "BRL") {
    return { action: "stop", result: fromRow(row, "snapshot_amount_mismatch", false) };
  }
  row.processingAttempts += 1;
  row.processingState = "processing";
  row.providerRefundStatus = "processing";
  row.status = "processing";
  row.errorClass = null;
  row.lastError = null;
  row.processingFinishedAt = null;
  row.providerRefundId = null;
  row.financialEffect = SANDBOX_FINANCIAL_EFFECT;
  return {
    action: "execute",
    command: {
      idempotencyKey: row.idempotencyKey ?? refundIdempotencyKey(row.id),
      mpPaymentId: row.mpPaymentId,
      amount: row.lockedAmount,
      currency: "BRL",
    },
  };
}

function decideFinish(
  rows: Map<string, StoredRefund>,
  input: { refundRequestId: string; response: SandboxProviderResponse }
): SandboxProcessingResult {
  const row = rows.get(input.refundRequestId);
  if (!row) return stopped({ error: "not_found", refundRequestStatus: "approved" });
  if (row.status === "refunded" && row.providerRefundId) return succeeded(row, true);
  if (row.processingState !== "processing" || row.status !== "processing") {
    return fromRow(row, "processing_in_progress", false);
  }

  const response = input.response;
  if (response.kind === "timeout") return markTimeout(row);
  if (response.kind === "temporary_error") return markFailure(row, "temporary", response.code);
  if (response.kind === "permanent_error") return markFailure(row, "permanent", response.code);
  if (!SANDBOX_PROVIDER_REFUND_ID.test(response.providerRefundId)) {
    return markFailure(row, "permanent", "untrusted_provider_refund_id");
  }
  if (response.currency !== "BRL" || !row.lockedAmount || compareExactMoney(response.amount, row.lockedAmount) !== 0) {
    return markFailure(row, "permanent", "snapshot_amount_mismatch");
  }

  row.status = "refunded";
  row.providerRefundStatus = "completed";
  row.providerRefundId = response.providerRefundId;
  row.processingState = "completed";
  row.processingFinishedAt = new Date().toISOString();
  row.lastError = null;
  row.errorClass = null;
  row.financialEffect = SANDBOX_FINANCIAL_EFFECT;
  return succeeded(row, false);
}

function markTimeout(row: StoredRefund): SandboxProcessingResult {
  row.processingState = "unknown";
  row.errorClass = "timeout";
  row.lastError = "provider_timeout";
  row.providerRefundStatus = "processing";
  row.status = "processing";
  row.providerRefundId = null;
  row.processingFinishedAt = null;
  row.financialEffect = SANDBOX_FINANCIAL_EFFECT;
  return fromRow(row, "provider_timeout", true);
}

function markFailure(row: StoredRefund, errorClass: "temporary" | "permanent", code: string): SandboxProcessingResult {
  row.processingState = "failed";
  row.errorClass = errorClass;
  row.lastError = redactRefundError(code);
  row.providerRefundStatus = "failed";
  row.status = "processing";
  row.providerRefundId = null;
  row.processingFinishedAt = null;
  row.financialEffect = SANDBOX_FINANCIAL_EFFECT;
  return fromRow(row, code, errorClass === "temporary");
}

export async function processSandboxMercadoPagoRefund(input: {
  actorUserId: string | null;
  request: SandboxRefundRequest;
  payment: SandboxPayment | null;
  untrusted?: UntrustedRefundCommand;
  provider: SandboxRefundProvider;
  store: SandboxRefundStore;
  retry?: boolean;
}): Promise<SandboxProcessingResult> {
  const priced = persistedRefundAmount({
    transactionAmount: input.payment?.amount ?? null,
    transactionCurrency: input.payment?.currency ?? null,
  });
  const untrustedError = rejectUntrustedRefundCommand(input.untrusted, priced.ok ? priced.amount : input.payment?.amount ?? null);
  if (untrustedError) {
    return stopped({ error: untrustedError, refundRequestStatus: input.request.status });
  }

  const decision = await input.store.begin({
    actorUserId: input.actorUserId,
    request: input.request,
    payment: input.payment,
    retry: input.retry,
  });
  if (decision.action === "stop") return decision.result;

  const audits: RefundAuditEvent[] = [
    {
      event: "refund_processing_started",
      refundRequestId: input.request.id,
      idempotencyKey: decision.command.idempotencyKey,
      outcome: "processing",
    },
  ];

  let response: SandboxProviderResponse;
  try {
    response = await input.provider.execute(decision.command);
    if (input.provider.scenario === "duplicate_response" && response.kind === "confirmed") {
      const again = await input.provider.execute(decision.command);
      const sameOperation =
        again.kind === "confirmed" &&
        again.providerRefundId === response.providerRefundId &&
        again.amount === response.amount &&
        again.currency === response.currency;
      response = sameOperation ? again : { kind: "timeout" };
    }
  } catch {
    response = { kind: "timeout" };
  }

  const settled = await input.store.finish({ refundRequestId: input.request.id, response });
  const recordedEffect: boolean = settled.financialEffect;
  if (recordedEffect !== false) {
    return stopped({
      error: "financial_effect_refused",
      refundRequestStatus: input.request.status,
      idempotencyKey: decision.command.idempotencyKey,
    });
  }
  const outcomeEvent: RefundAuditEvent["event"] = settled.ok
    ? "refund_processing_succeeded"
    : settled.error === "provider_timeout"
      ? "refund_processing_timeout"
      : "refund_processing_failed";
  const outcome: RefundAuditEvent["outcome"] = settled.ok ? "succeeded" : settled.error === "provider_timeout" ? "timeout" : "failed";
  audits.push({
    event: outcomeEvent,
    refundRequestId: input.request.id,
    idempotencyKey: decision.command.idempotencyKey,
    outcome,
  });
  return { ...settled, audits };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { refundIdempotencyKey } from "@/lib/domain/mercadopago-refund";
import { rootLogger } from "@/lib/observability/logger";

const refundLog = rootLogger.child({ component: "refund-review" });
import { REFUND_WINDOW_DAYS } from "@/lib/domain/refund-policy";
import {
  assessRefundWindow,
  assessRefundWindowFromInstant,
  decideRefundReview,
  refundRequestFingerprint,
  saoPauloDateFromInstant,
  saoPauloDateIso,
  type RefundRequestReason,
  type RefundRequestStatus,
  type RefundReviewAction,
  type RefundWindowAssessment,
} from "@/lib/domain/refund-request";
import {
  executeLiveMercadoPagoRefund,
  type LiveMercadoPagoRefundResult,
} from "@/lib/server/mercadopago-refund-live";

export type StoredRefundRequestStatus = RefundRequestStatus | "processing" | "refunded";
export type RefundProviderStatus = "not_sent" | "processing" | "completed" | "failed";
export type RefundProcessingState = "processing" | "simulated" | "failed" | "unknown" | "completed";
export type RefundProcessingErrorClass = "temporary" | "permanent" | "timeout";

export type RefundRequestRow = {
  id: string;
  client_mutation_id: string;
  mp_payment_id: string;
  payer_email: string;
  reason: RefundRequestReason;
  notes: string;
  intensive_use_declared: boolean;
  paid_on: string | null;
  window_assessment: RefundWindowAssessment;
  status: StoredRefundRequestStatus;
  request_fingerprint: string;
  resolution_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  checkout_session_id: string | null;
  requester_user_id?: string | null;
  payer_email_matches_checkout: boolean | null;
  provider: "mercadopago";
  provider_refund_status: RefundProviderStatus;
  provider_refund_id?: string | null;
  processing_state?: RefundProcessingState | null;
  idempotency_key?: string | null;
  processing_started_at?: string | null;
  processing_finished_at?: string | null;
  processing_attempts?: number | null;
  last_processing_error?: string | null;
  processing_error_class?: RefundProcessingErrorClass | null;
  financial_effect?: boolean | null;
  created_at: string;
  updated_at: string;
};

type RefundRequestInsert = {
  client_mutation_id: string;
  mp_payment_id: string;
  payer_email: string;
  reason: RefundRequestReason;
  notes: string;
  intensive_use_declared: boolean;
  paid_on: string | null;
  window_assessment: RefundWindowAssessment;
  status: "submitted";
  request_fingerprint: string;
  checkout_session_id: string | null;
  requester_user_id: string | null;
  payer_email_matches_checkout: boolean | null;
  provider: "mercadopago";
  provider_refund_status: "not_sent";
};

type RefundRequestDb = {
  public: {
    Tables: {
      refund_requests: {
        Row: RefundRequestRow;
        Insert: RefundRequestInsert;
        Update: Partial<RefundRequestRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type CreateRefundRequestInput = {
  clientMutationId: string;
  payerEmail: string;
  mpPaymentId: string;
  reason: RefundRequestReason;
  notes: string;
  intensiveUseDeclared: boolean;
  paidOn: string | null;
};

export type CreateRefundRequestResult =
  | { ok: true; id: string; status: StoredRefundRequestStatus; replayed: boolean }
  | { ok: false; error: string; status: number };

export type ReviewRefundRequestResult =
  | { ok: true; id: string; status: StoredRefundRequestStatus }
  | { ok: false; error: string; message?: string };

export type RefundExecutor = (input: {
  mpPaymentId: string;
  idempotencyKey: string;
}) => Promise<LiveMercadoPagoRefundResult>;

type CheckoutMatch = {
  id: string;
  payer_email: string;
  mp_payment_paid_at: string | null;
};

export type RefundRequestStore = {
  findByMutationId(clientMutationId: string): Promise<RefundRequestRow | null>;
  findById(id: string): Promise<RefundRequestRow | null>;
  insert(row: RefundRequestInsert): Promise<{ error: { code?: string; message?: string } | null }>;
  findCheckout(mpPaymentId: string): Promise<CheckoutMatch | null>;
  updateIfStatus(
    id: string,
    expectedStatus: StoredRefundRequestStatus,
    patch: Partial<RefundRequestRow>,
    guard?: { processingState?: RefundProcessingState | null }
  ): Promise<RefundRequestRow | null>;
  listRecent(limit: number): Promise<RefundRequestRow[]>;
  cancelSubscriptionForPayment?(
    mpPaymentId: string,
    at: string
  ): Promise<"canceled" | "already" | "none">;
};

function refundTable(admin: SupabaseClient<Database>) {
  return (admin as unknown as SupabaseClient<RefundRequestDb>).from("refund_requests");
}

function paidOnFromCheckout(paidAt: string | null): string | null {
  if (!paidAt) return null;
  return saoPauloDateFromInstant(paidAt);
}

export function createRefundRequestStore(admin: SupabaseClient<Database>): RefundRequestStore {
  return {
    async findByMutationId(clientMutationId) {
      const { data, error } = await refundTable(admin)
        .select("*")
        .eq("client_mutation_id", clientMutationId)
        .maybeSingle();
      if (error) throw new Error("refund_request_lookup_failed");
      return data;
    },
    async findById(id) {
      const { data, error } = await refundTable(admin).select("*").eq("id", id).maybeSingle();
      if (error) throw new Error("refund_request_lookup_failed");
      return data;
    },
    async insert(row) {
      const { error } = await refundTable(admin).insert(row);
      return { error: error ? { code: error.code, message: error.message } : null };
    },
    async findCheckout(mpPaymentId) {
      const { data, error } = await admin
        .from("checkout_sessions")
        .select("id, payer_email, mp_payment_paid_at")
        .eq("mp_payment_id", mpPaymentId)
        .maybeSingle();
      if (error) throw new Error("refund_request_checkout_lookup_failed");
      return data;
    },
    async updateIfStatus(id, expectedStatus, patch, guard) {
      const base = refundTable(admin).update(patch).eq("id", id).eq("status", expectedStatus);
      const guarded = guard?.processingState
        ? base.eq("processing_state", guard.processingState)
        : base;
      const { data, error } = await guarded.select("*").maybeSingle();
      if (error) throw new Error("refund_request_update_failed");
      return data;
    },
    async listRecent(limit) {
      const { data, error } = await refundTable(admin)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error("refund_request_list_failed");
      return data ?? [];
    },
    async cancelSubscriptionForPayment(mpPaymentId, at) {
      const { data: session, error: sessionError } = await admin
        .from("checkout_sessions")
        .select("onboarding_subscription_id")
        .eq("mp_payment_id", mpPaymentId)
        .maybeSingle();
      if (sessionError) throw new Error("refund_subscription_lookup_failed");
      const subscriptionId = session?.onboarding_subscription_id ?? null;
      if (!subscriptionId) return "none";

      const { data: subscription, error: subscriptionError } = await admin
        .from("subscriptions")
        .select("status")
        .eq("id", subscriptionId)
        .maybeSingle();
      if (subscriptionError) throw new Error("refund_subscription_lookup_failed");
      if (!subscription) return "none";
      if (subscription.status === "canceled" || subscription.status === "cancelled") return "already";

      const { error: updateError } = await admin
        .from("subscriptions")
        .update({ status: "canceled", cancelled_at: at })
        .eq("id", subscriptionId);
      if (updateError) throw new Error("refund_subscription_cancel_failed");
      return "canceled";
    },
  };
}

function uniqueViolation(error: { code?: string; message?: string } | null): "mutation" | "payment" | null {
  if (error?.code !== "23505") return null;
  const message = error.message ?? "";
  if (message.includes("refund_requests_open_payment_uidx")) return "payment";
  return "mutation";
}

export async function createRefundRequest(
  store: RefundRequestStore,
  input: CreateRefundRequestInput,
  now: Date = new Date()
): Promise<CreateRefundRequestResult> {
  const todayIso = saoPauloDateIso(now);
  if (input.paidOn && input.paidOn > todayIso) {
    return { ok: false, error: "paid_on_in_future", status: 400 };
  }

  const existing = await store.findByMutationId(input.clientMutationId);
  if (existing) {
    return replayOrMismatch(existing, input);
  }

  const checkout = await store.findCheckout(input.mpPaymentId);
  const paidOn = paidOnFromCheckout(checkout?.mp_payment_paid_at ?? null) ?? input.paidOn;
  if (paidOn && paidOn > todayIso) {
    return { ok: false, error: "paid_on_in_future", status: 400 };
  }

  const fingerprint = refundRequestFingerprint({
    payerEmail: input.payerEmail,
    mpPaymentId: input.mpPaymentId,
    reason: input.reason,
    notes: input.notes,
    intensiveUseDeclared: input.intensiveUseDeclared,
    paidOn: input.paidOn,
  });
  const windowAssessment = assessRefundWindow({
    paidOn,
    todayIso,
    windowDays: REFUND_WINDOW_DAYS,
  });
  const emailMatches =
    checkout == null
      ? null
      : checkout.payer_email.trim().toLowerCase() === input.payerEmail.trim().toLowerCase();

  const inserted = await store.insert({
    client_mutation_id: input.clientMutationId,
    mp_payment_id: input.mpPaymentId,
    payer_email: input.payerEmail.trim().toLowerCase(),
    reason: input.reason,
    notes: input.notes.trim(),
    intensive_use_declared: input.intensiveUseDeclared,
    paid_on: paidOn,
    window_assessment: windowAssessment,
    status: "submitted",
    request_fingerprint: fingerprint,
    checkout_session_id: checkout?.id ?? null,
    requester_user_id: null,
    payer_email_matches_checkout: emailMatches,
    provider: "mercadopago",
    provider_refund_status: "not_sent",
  });

  if (inserted.error) {
    const violation = uniqueViolation(inserted.error);
    if (violation === "payment") {
      return { ok: false, error: "open_refund_request_exists", status: 409 };
    }
    if (violation === "mutation") {
      const raced = await store.findByMutationId(input.clientMutationId);
      if (raced) return replayOrMismatch(raced, input);
    }
    return { ok: false, error: "unavailable", status: 503 };
  }

  const created = await store.findByMutationId(input.clientMutationId);
  if (!created) return { ok: false, error: "unavailable", status: 503 };
  return { ok: true, id: created.id, status: created.status, replayed: false };
}

function replayOrMismatch(
  existing: RefundRequestRow,
  input: CreateRefundRequestInput
): CreateRefundRequestResult {
  const fingerprint = refundRequestFingerprint({
    payerEmail: input.payerEmail,
    mpPaymentId: input.mpPaymentId,
    reason: input.reason,
    notes: input.notes,
    intensiveUseDeclared: input.intensiveUseDeclared,
    paidOn: input.paidOn,
  });
  if (fingerprint !== existing.request_fingerprint) {
    return { ok: false, error: "idempotency_payload_mismatch", status: 409 };
  }
  return { ok: true, id: existing.id, status: existing.status, replayed: true };
}

export async function reviewRefundRequest(
  store: RefundRequestStore,
  input: {
    id: string;
    action: RefundReviewAction;
    resolutionNote: string;
    acknowledgeOutsideWindow: boolean;
    reviewerId: string;
    now?: Date;
    refundExecutor?: RefundExecutor;
  }
): Promise<ReviewRefundRequestResult> {
  const current = await store.findById(input.id);
  if (!current) return { ok: false, error: "refund_request_not_found" };
  if (current.provider_refund_status !== "not_sent") {
    return { ok: false, error: "provider_refund_already_recorded" };
  }

  if (current.status === "processing" || current.status === "refunded") {
    return { ok: false, error: "refund_request_terminal" };
  }

  const now = input.now ?? new Date();
  const checkout = await store.findCheckout(current.mp_payment_id);
  const paidAt = checkout?.mp_payment_paid_at ? new Date(checkout.mp_payment_paid_at) : null;
  const windowAssessment =
    paidAt && !Number.isNaN(paidAt.getTime())
      ? assessRefundWindowFromInstant(paidAt, now)
      : current.window_assessment;

  // Falha definitiva do provedor (approved + failed): o admin pode tentar de novo com a mesma chave.
  // Unknown (processing + unknown) nunca cai aqui: só sai por reconciliação manual.
  if (current.status === "approved" && current.processing_state === "failed") {
    const retryDecision = decideRefundReview({
      status: "in_review",
      action: input.action,
      windowAssessment,
      resolutionNote: input.resolutionNote,
      acknowledgeOutsideWindow: input.acknowledgeOutsideWindow,
    });
    if (!retryDecision.ok) return retryDecision;
    if (retryDecision.nextStatus !== "approved") return { ok: false, error: "invalid_transition" };
    return settleApprovedRefund(store, current, input, now, true);
  }

  const decision = decideRefundReview({
    status: current.status,
    action: input.action,
    windowAssessment,
    resolutionNote: input.resolutionNote,
    acknowledgeOutsideWindow: input.acknowledgeOutsideWindow,
  });
  if (!decision.ok) return decision;

  if (decision.nextStatus === "approved") {
    return settleApprovedRefund(store, current, input, now, false);
  }

  const updated = await store.updateIfStatus(current.id, current.status, {
    status: decision.nextStatus,
    resolution_note: input.resolutionNote.trim() || null,
    reviewed_by: input.reviewerId,
    reviewed_at: (input.now ?? new Date()).toISOString(),
    provider_refund_status: "not_sent",
  });
  if (!updated) return { ok: false, error: "refund_request_conflict" };
  return { ok: true, id: updated.id, status: updated.status };
}

const LIVE_REFUND_ID = /^\d{1,20}$/;
const RECORD_ATTEMPTS = 3;

type FailedLiveRefund = Extract<LiveMercadoPagoRefundResult, { ok: false }>;

/** Refusal before acceptance: the refund did not happen, so the claim can be recorded as failed. */
function isProviderRefusal(live: FailedLiveRefund): boolean {
  return live.error === "mp_not_configured" || live.error === "mp_payment_not_refundable" || live.providerRejected === true;
}

/**
 * The provider refused the refund (definitive failure). The row stays approved with
 * processing_state=failed. That is not a completed refund and does not block a new request.
 * This flow never returns the row to in_review. No database trigger enforces that; only the
 * idempotency_key is immutable (trigger in 20261013153858).
 */
async function recordRefusal(
  store: RefundRequestStore,
  current: RefundRequestRow,
  live: FailedLiveRefund
): Promise<ReviewRefundRequestResult> {
  try {
    const recorded = await store.updateIfStatus(current.id, "approved", {
      processing_state: "failed",
      last_processing_error: live.error,
    });
    if (!recorded) return { ok: false, error: "refund_request_conflict" };
  } catch {
    refundLog.warn("mp_refund_failure_unrecorded", { refundRequestId: current.id });
  }
  return live.message ? { ok: false, error: live.error, message: live.message } : { ok: false, error: live.error };
}

/**
 * The outcome is unknown (timeout, network error, 5xx, unreadable response). The refund may have
 * been accepted, so the request goes to reconciliation with the same key. It is never released or resent.
 */
async function recordUnknownOutcome(
  store: RefundRequestStore,
  current: RefundRequestRow,
  idempotencyKey: string,
  code: string
): Promise<ReviewRefundRequestResult> {
  try {
    const recorded = await store.updateIfStatus(current.id, "approved", {
      status: "processing",
      provider_refund_status: "processing",
      processing_state: "unknown",
      processing_error_class: "timeout",
      last_processing_error: code,
    });
    if (!recorded) refundLog.warn("mp_refund_outcome_conflict", { refundRequestId: current.id });
  } catch {
    refundLog.warn("mp_refund_outcome_unrecorded", { refundRequestId: current.id });
  }
  refundLog.warn("mp_refund_outcome_unknown", { refundRequestId: current.id, error: code });
  return {
    ok: false,
    error: "mp_refund_outcome_unknown",
    message: `O Mercado Pago não confirmou se o estorno foi aceito. Pedido em reconciliação pela chave ${idempotencyKey}; não reenviar.`,
  };
}

async function settleApprovedRefund(
  store: RefundRequestStore,
  current: RefundRequestRow,
  input: {
    resolutionNote: string;
    reviewerId: string;
    now?: Date;
    refundExecutor?: RefundExecutor;
  },
  now: Date,
  retry: boolean
): Promise<ReviewRefundRequestResult> {
  const idempotencyKey = refundIdempotencyKey(current.id);
  const startedAt = now.toISOString();

  // 1) Antes de qualquer efeito externo: uma única atualização condicional grava a aprovação
  // e o claim (processing_state=processing, chave de idempotência). Se outro revisor mudou o
  // status, ou se já há claim para o mesmo pagamento (índice único), nada é enviado ao MP.
  // Retentativa: só se a linha ainda estiver approved + failed; a mesma chave é reutilizada.
  const claimPatch: Partial<RefundRequestRow> = {
    status: "approved",
    resolution_note: input.resolutionNote.trim() || null,
    reviewed_by: input.reviewerId,
    reviewed_at: startedAt,
    processing_state: "processing",
    idempotency_key: idempotencyKey,
    processing_started_at: startedAt,
    processing_attempts: retry ? Math.max(1, (current.processing_attempts ?? 0) + 1) : 1,
    last_processing_error: null,
    processing_error_class: null,
  };
  let claimed: RefundRequestRow | null;
  try {
    claimed = retry
      ? await store.updateIfStatus(current.id, "approved", claimPatch, { processingState: "failed" })
      : await store.updateIfStatus(current.id, "in_review", claimPatch);
  } catch {
    return { ok: false, error: "unavailable" };
  }
  if (!claimed) return { ok: false, error: "refund_request_conflict" };

  // 2) Efeito externo com a mesma chave. Não há reenvio neste fluxo.
  const executor = input.refundExecutor ?? executeLiveMercadoPagoRefund;
  let live: LiveMercadoPagoRefundResult;
  try {
    live = await executor({ mpPaymentId: current.mp_payment_id, idempotencyKey });
  } catch {
    refundLog.warn("mp_refund_not_completed", { error: "mp_refund_threw", refundRequestId: current.id });
    return recordUnknownOutcome(store, current, idempotencyKey, "mp_refund_threw");
  }
  if (!live.ok) {
    // Só o código do erro e o id do pedido: nada de e-mail, token ou corpo do MP.
    refundLog.warn("mp_refund_not_completed", { error: live.error, refundRequestId: current.id });
    if (isProviderRefusal(live)) return recordRefusal(store, current, live);
    return recordUnknownOutcome(store, current, idempotencyKey, live.error);
  }
  const refundId = String(live.refundId);
  if (!LIVE_REFUND_ID.test(refundId)) {
    return recordUnknownOutcome(store, current, idempotencyKey, "mp_invalid_refund_id");
  }

  // 3) Sucesso: registra o id do estorno. Nunca reenvia o estorno para gravar.
  const finishedAt = (input.now ?? new Date()).toISOString();
  const completion: Partial<RefundRequestRow> = {
    status: "refunded",
    provider_refund_status: "completed",
    provider_refund_id: refundId,
    processing_state: "completed",
    idempotency_key: idempotencyKey,
    processing_started_at: startedAt,
    processing_finished_at: finishedAt,
    processing_attempts: 1,
    last_processing_error: null,
    processing_error_class: null,
    financial_effect: true,
    resolution_note: input.resolutionNote.trim() || null,
    reviewed_by: input.reviewerId,
    reviewed_at: finishedAt,
  };
  let updated: RefundRequestRow | null = null;
  for (let attempt = 1; attempt <= RECORD_ATTEMPTS; attempt++) {
    try {
      updated = await store.updateIfStatus(current.id, "approved", completion);
      break;
    } catch {
      refundLog.warn("mp_refund_record_retry", { refundRequestId: current.id, attempt });
    }
  }
  if (!updated) {
    // Estorno aceito pelo MP, mas sem registro: fica reconciliável pela chave, sem reenvio.
    refundLog.warn("mp_refund_record_conflict", { refundRequestId: current.id });
    return {
      ok: false,
      error: "refund_record_pending_reconciliation",
      message: `Estorno aceito pelo Mercado Pago (id ${refundId}), mas não gravado. Reconciliar pela chave ${idempotencyKey}; não reenviar.`,
    };
  }
  try {
    const outcome = store.cancelSubscriptionForPayment
      ? await store.cancelSubscriptionForPayment(current.mp_payment_id, finishedAt)
      : "none";
    if (outcome === "canceled") {
      refundLog.info("refund_subscription_canceled", { refundRequestId: current.id });
    }
  } catch {
    refundLog.warn("refund_subscription_cancel_failed", { refundRequestId: current.id });
  }
  refundLog.info("mp_refund_completed", { refundRequestId: current.id, alreadyRefunded: live.alreadyRefunded });
  return { ok: true, id: updated.id, status: updated.status };
}

export type ReconcileUnknownOutcome = "refunded" | "not_refunded";

/**
 * Manual reconciliation of processing + unknown. The admin states the outcome after checking
 * Mercado Pago outside this system. This function never calls the provider and never resends.
 * refunded requires the numeric provider refund id, because the database requires it for status refunded.
 */
export async function reconcileUnknownRefundRequest(
  store: RefundRequestStore,
  input: {
    id: string;
    outcome: ReconcileUnknownOutcome;
    evidenceNote: string;
    providerRefundId?: string | null;
    reviewerId: string;
    now?: Date;
  }
): Promise<ReviewRefundRequestResult> {
  const current = await store.findById(input.id);
  if (!current) return { ok: false, error: "refund_request_not_found" };
  if (current.status !== "processing" || current.processing_state !== "unknown") {
    return { ok: false, error: "refund_request_not_unknown" };
  }
  const note = input.evidenceNote.trim();
  if (note.length < 3) return { ok: false, error: "evidence_note_required" };

  const at = (input.now ?? new Date()).toISOString();
  const common: Partial<RefundRequestRow> = {
    resolution_note: note,
    reviewed_by: input.reviewerId,
    reviewed_at: at,
  };

  let updated: RefundRequestRow | null;
  if (input.outcome === "refunded") {
    const refundId = (input.providerRefundId ?? "").trim();
    if (!LIVE_REFUND_ID.test(refundId)) return { ok: false, error: "provider_refund_id_required" };
    updated = await store.updateIfStatus(
      current.id,
      "processing",
      {
        ...common,
        status: "refunded",
        provider_refund_status: "completed",
        provider_refund_id: refundId,
        processing_state: "completed",
        processing_finished_at: at,
        processing_error_class: null,
        last_processing_error: null,
        financial_effect: true,
      },
      { processingState: "unknown" }
    );
  } else {
    updated = await store.updateIfStatus(
      current.id,
      "processing",
      {
        ...common,
        status: "approved",
        provider_refund_status: "not_sent",
        processing_state: "failed",
        processing_error_class: null,
        last_processing_error: "reconciled_not_refunded",
      },
      { processingState: "unknown" }
    );
  }
  if (!updated) return { ok: false, error: "refund_request_conflict" };

  refundLog.info("mp_refund_reconciled", { refundRequestId: current.id, outcome: input.outcome });
  return { ok: true, id: updated.id, status: updated.status };
}

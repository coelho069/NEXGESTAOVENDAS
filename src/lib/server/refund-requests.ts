import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { REFUND_WINDOW_DAYS } from "@/lib/domain/refund-policy";
import {
  assessRefundWindow,
  assessRefundWindowFromInstant,
  decideRefundReview,
  planMercadoPagoRefund,
  refundRequestFingerprint,
  saoPauloDateFromInstant,
  saoPauloDateIso,
  type RefundRequestReason,
  type RefundRequestStatus,
  type RefundReviewAction,
  type RefundWindowAssessment,
} from "@/lib/domain/refund-request";

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
  status: RefundRequestStatus;
  request_fingerprint: string;
  resolution_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  checkout_session_id: string | null;
  requester_user_id?: string | null;
  payer_email_matches_checkout: boolean | null;
  provider: "mercadopago";
  provider_refund_status: "not_sent";
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
  | { ok: true; id: string; status: RefundRequestStatus; replayed: boolean }
  | { ok: false; error: string; status: number };

export type ReviewRefundRequestResult =
  | { ok: true; id: string; status: RefundRequestStatus }
  | { ok: false; error: string };

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
    expectedStatus: RefundRequestStatus,
    patch: Partial<RefundRequestRow>
  ): Promise<RefundRequestRow | null>;
  listRecent(limit: number): Promise<RefundRequestRow[]>;
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
    async updateIfStatus(id, expectedStatus, patch) {
      const { data, error } = await refundTable(admin)
        .update(patch)
        .eq("id", id)
        .eq("status", expectedStatus)
        .select("*")
        .maybeSingle();
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
  }
): Promise<ReviewRefundRequestResult> {
  const current = await store.findById(input.id);
  if (!current) return { ok: false, error: "refund_request_not_found" };
  if (current.provider_refund_status !== "not_sent") {
    return { ok: false, error: "provider_refund_already_recorded" };
  }

  const now = input.now ?? new Date();
  const checkout = await store.findCheckout(current.mp_payment_id);
  const paidAt = checkout?.mp_payment_paid_at ? new Date(checkout.mp_payment_paid_at) : null;
  const windowAssessment =
    paidAt && !Number.isNaN(paidAt.getTime())
      ? assessRefundWindowFromInstant(paidAt, now)
      : current.window_assessment;

  const decision = decideRefundReview({
    status: current.status,
    action: input.action,
    windowAssessment,
    resolutionNote: input.resolutionNote,
    acknowledgeOutsideWindow: input.acknowledgeOutsideWindow,
  });
  if (!decision.ok) return decision;

  if (decision.nextStatus === "approved") {
    const intent = planMercadoPagoRefund(current.mp_payment_id);
    if (intent.dispatch !== "not_sent" || intent.provider !== "mercadopago") {
      return { ok: false, error: "provider_refund_not_enabled" };
    }
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

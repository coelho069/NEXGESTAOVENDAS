/**
 * Creates a SaaS refund analysis request for a payment the signed-in client owns.
 * Inserts a row only. Does not call Mercado Pago or Stripe.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import {
  assessClientRefundEligibility,
  clientOwnsCheckoutPayment,
  normalizeRefundActorEmail,
  presentClientRefundPayments,
  type ClientCheckoutPayment,
  type ClientRefundActor,
  type ClientRefundFormReason,
  type ClientRefundPaymentView,
} from "@/lib/domain/client-refund-eligibility";
import { refundRequestFingerprint, type RefundRequestStatus } from "@/lib/domain/refund-request";
import {
  createRefundRequestStore,
  type CreateRefundRequestResult,
  type RefundRequestStore,
} from "@/lib/server/refund-requests";

const CHECKOUT_COLUMNS =
  "id, payer_email, mp_payment_id, mp_payment_status, mp_payment_paid_at, onboarding_user_id, onboarding_organization_id";

type CheckoutRow = {
  id: string;
  payer_email: string;
  mp_payment_id: string | null;
  mp_payment_status: string | null;
  mp_payment_paid_at: string | null;
  onboarding_user_id: string | null;
  onboarding_organization_id: string | null;
};

export type OwnedRefundRequestInput = {
  actor: ClientRefundActor;
  checkout: ClientCheckoutPayment | null;
  hasOpenRequest: boolean;
  clientMutationId: string;
  mpPaymentId: string;
  reason: ClientRefundFormReason;
  notes: string;
  intensiveUseDeclared: boolean;
  now?: Date;
};

type RefundRequestLookup = {
  mp_payment_id: string;
  status: RefundRequestStatus;
  created_at: string;
};

function refundRequestLookup(admin: SupabaseClient<Database>) {
  return (admin as unknown as SupabaseClient<{
    public: {
      Tables: {
        refund_requests: {
          Row: RefundRequestLookup;
          Insert: Record<string, never>;
          Update: Record<string, never>;
          Relationships: [];
        };
      };
      Views: Record<string, never>;
      Functions: Record<string, never>;
      Enums: Record<string, never>;
      CompositeTypes: Record<string, never>;
    };
  }>).from("refund_requests");
}

function toPayment(row: CheckoutRow): ClientCheckoutPayment {
  return {
    id: row.id,
    payerEmail: row.payer_email,
    mpPaymentId: row.mp_payment_id,
    mpPaymentStatus: row.mp_payment_status,
    mpPaymentPaidAt: row.mp_payment_paid_at,
    onboardingUserId: row.onboarding_user_id,
    onboardingOrganizationId: row.onboarding_organization_id,
  };
}

export function createClientRefundReader(admin: SupabaseClient<Database>) {
  return {
    async listCheckoutsForActor(actor: ClientRefundActor): Promise<CheckoutRow[]> {
      const email = normalizeRefundActorEmail(actor.email);
      const [byUser, byEmail] = await Promise.all([
        admin.from("checkout_sessions").select(CHECKOUT_COLUMNS).eq("onboarding_user_id", actor.userId),
        email
          ? admin.from("checkout_sessions").select(CHECKOUT_COLUMNS).eq("payer_email", email)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (byUser.error || byEmail.error) {
        throw new Error("client_refund_checkout_lookup_failed");
      }
      const merged = new Map<string, CheckoutRow>();
      for (const row of [...(byUser.data ?? []), ...(byEmail.data ?? [])] as CheckoutRow[]) {
        merged.set(row.id, row);
      }
      return [...merged.values()];
    },
    async findCheckoutByPaymentId(mpPaymentId: string): Promise<CheckoutRow | null> {
      const { data, error } = await admin
        .from("checkout_sessions")
        .select(CHECKOUT_COLUMNS)
        .eq("mp_payment_id", mpPaymentId)
        .limit(1);
      if (error) throw new Error("client_refund_checkout_lookup_failed");
      const row = (data ?? [])[0] as CheckoutRow | undefined;
      return row ?? null;
    },
    async listRequestsForPayments(mpPaymentIds: string[]): Promise<RefundRequestLookup[]> {
      if (mpPaymentIds.length === 0) return [];
      const { data, error } = await refundRequestLookup(admin)
        .select("mp_payment_id, status, created_at")
        .in("mp_payment_id", mpPaymentIds);
      if (error) throw new Error("client_refund_request_lookup_failed");
      return data ?? [];
    },
    async hasOpenRequest(mpPaymentId: string): Promise<boolean> {
      const { data, error } = await refundRequestLookup(admin)
        .select("status")
        .eq("mp_payment_id", mpPaymentId)
        .in("status", ["submitted", "in_review"])
        .limit(1);
      if (error) throw new Error("client_refund_request_lookup_failed");
      return (data ?? []).length > 0;
    },
  };
}

export async function listOwnedRefundPayments(
  admin: SupabaseClient<Database>,
  actor: ClientRefundActor,
  now: Date = new Date()
): Promise<ClientRefundPaymentView[]> {
  const reader = createClientRefundReader(admin);
  const checkouts = (await reader.listCheckoutsForActor(actor))
    .map(toPayment)
    .filter((checkout) => clientOwnsCheckoutPayment(actor, checkout));
  const ownedIds = checkouts
    .map((row) => row.mpPaymentId?.trim() ?? "")
    .filter((id) => /^\d{6,20}$/.test(id));
  const requests = await reader.listRequestsForPayments(ownedIds);
  return presentClientRefundPayments({
    actor,
    checkouts,
    requests: requests.map((request) => ({
      mpPaymentId: request.mp_payment_id,
      status: request.status,
      createdAt: request.created_at,
    })),
    now,
  });
}

export async function createOwnedRefundRequest(
  store: RefundRequestStore,
  input: OwnedRefundRequestInput
): Promise<CreateRefundRequestResult> {
  const now = input.now ?? new Date();
  const checkout = input.checkout;
  if (!checkout || checkout.mpPaymentId?.trim() !== input.mpPaymentId) {
    return { ok: false, error: "payment_not_owned", status: 403 };
  }

  const eligibility = assessClientRefundEligibility({
    actor: input.actor,
    payment: checkout,
    now,
    openRequest: input.hasOpenRequest,
    intensiveUseDeclared: input.intensiveUseDeclared,
  });
  if (!eligibility.eligible) {
    const status = eligibility.reason === "not_owner" ? 403 : eligibility.reason === "open_request" ? 409 : 400;
    const error =
      eligibility.reason === "not_owner"
        ? "payment_not_owned"
        : eligibility.reason === "open_request"
          ? "open_refund_request_exists"
          : eligibility.reason;
    return { ok: false, error, status };
  }

  const payerEmail = normalizeRefundActorEmail(checkout.payerEmail);
  const notes = input.notes.trim();
  const fingerprint = refundRequestFingerprint({
    payerEmail,
    mpPaymentId: eligibility.mpPaymentId,
    reason: input.reason,
    notes,
    intensiveUseDeclared: false,
    paidOn: eligibility.paidOn,
  });

  const existing = await store.findByMutationId(input.clientMutationId);
  if (existing) {
    if (existing.payer_email !== payerEmail || existing.mp_payment_id !== eligibility.mpPaymentId) {
      return { ok: false, error: "payment_not_owned", status: 403 };
    }
    if (existing.request_fingerprint !== fingerprint) {
      return { ok: false, error: "idempotency_payload_mismatch", status: 409 };
    }
    return { ok: true, id: existing.id, status: existing.status, replayed: true };
  }

  const inserted = await store.insert({
    client_mutation_id: input.clientMutationId,
    mp_payment_id: eligibility.mpPaymentId,
    payer_email: payerEmail,
    reason: input.reason,
    notes,
    intensive_use_declared: false,
    paid_on: eligibility.paidOn,
    window_assessment: "within_window",
    status: "submitted",
    request_fingerprint: fingerprint,
    checkout_session_id: checkout.id,
    requester_user_id: input.actor.userId,
    payer_email_matches_checkout: true,
    provider: "mercadopago",
    provider_refund_status: "not_sent",
  });

  if (inserted.error) {
    const message = inserted.error.message ?? "";
    if (inserted.error.code === "23505" && message.includes("refund_requests_open_payment_uidx")) {
      return { ok: false, error: "open_refund_request_exists", status: 409 };
    }
    if (inserted.error.code === "23505") {
      const raced = await store.findByMutationId(input.clientMutationId);
      if (raced && raced.request_fingerprint === fingerprint && raced.payer_email === payerEmail) {
        return { ok: true, id: raced.id, status: raced.status, replayed: true };
      }
    }
    return { ok: false, error: "unavailable", status: 503 };
  }

  const created = await store.findByMutationId(input.clientMutationId);
  if (!created) return { ok: false, error: "unavailable", status: 503 };
  return { ok: true, id: created.id, status: created.status, replayed: false };
}

export function ownedRefundStore(admin: SupabaseClient<Database>): RefundRequestStore {
  return createRefundRequestStore(admin);
}

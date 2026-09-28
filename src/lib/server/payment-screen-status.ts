/**
 * Server-only resolver for the public payment confirmation screens
 * (/pagamento/*). READ-ONLY by design: the MP webhook remains the single
 * source of truth that fulfills a payment; this layer only surfaces what is
 * already persisted on the checkout_session row.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { money } from "@/lib/money";
import {
  findCheckoutSessionByMpPaymentId,
  normalizeCheckoutSessionEmail,
  type PublicCheckoutSessionState,
} from "@/lib/server/public-checkout-sessions";

type AdminClient = SupabaseClient<Database>;

function asSessionState(value: unknown): PublicCheckoutSessionState {
  return value as PublicCheckoutSessionState;
}

export type PaymentScreenOutcome = "paid" | "pending" | "failed" | "unknown";

export type PaymentScreenSnapshot = {
  outcome: PaymentScreenOutcome;
  plan_name: string | null;
  amount: number | null;
  currency: string | null;
  masked_email: string | null;
  /** Present when the onboarding e-mail (PDV access) has already been sent. */
  access_email_sent: boolean;
  onboarding_error: string | null;
  matched_by: "external_reference" | "mp_payment_id" | "preference_id" | null;
};

const APPROVED_STATUSES = new Set(["approved", "accredited", "paid"]);
/** checkout_sessions.client_mutation_id is a uuid column: guard against 22P02. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAILED_MP_STATUSES = new Set([
  "rejected",
  "cancelled",
  "canceled",
  "refunded",
  "charged_back",
  "mediation",
]);
const FAILED_SESSION_STATUSES = new Set(["failed", "canceled", "cancelled"]);

function maskEmail(email: string): string {
  const normalized = email.trim();
  const at = normalized.lastIndexOf("@");
  if (at <= 0) return "seu e-mail";
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${"*".repeat(Math.max(2, local.length - head.length))}@${domain}`;
}

function mapSessionStatus(session: {
  status: string;
  mp_payment_status: string | null;
  onboarding_status: string | null;
  onboarding_error: string | null;
}): PaymentScreenOutcome {
  // Session lifecycle status is authoritative for terminal failures.
  if (FAILED_SESSION_STATUSES.has(session.status.trim().toLowerCase())) {
    return "failed";
  }
  const mpStatus = session.mp_payment_status?.trim().toLowerCase() ?? "";
  if (APPROVED_STATUSES.has(mpStatus)) return "paid";
  if (FAILED_MP_STATUSES.has(mpStatus)) return "failed";
  return "pending";
}

export type PaymentScreenResolution =
  | { ok: true; snapshot: PaymentScreenSnapshot }
  | { ok: false; reason: "not_found" | "database" };

async function loadPlanSnapshot(
  admin: AdminClient,
  planId: string
): Promise<{ name: string | null; amount: number | null; currency: string | null }> {
  const { data } = await admin
    .from("plans")
    .select("name, amount, currency")
    .eq("id", planId)
    .maybeSingle();
  if (!data) return { name: null, amount: null, currency: null };
  const amount =
    typeof data.amount === "number" ? data.amount : Number(data.amount ?? NaN);
  return {
    name: typeof data.name === "string" ? data.name : null,
    amount: Number.isFinite(amount) && money(amount).gt(0) ? amount : null,
    currency: typeof data.currency === "string" ? data.currency : null,
  };
}

/**
 * Resolve the screen snapshot from the query params MP sends back on the
 * return URLs (collection_id, payment_id, external_reference,
 * preference_id, merchant_order_id). Order: external_reference (the
 * client_mutation_id anchored at preference creation) → mp_payment_id →
 * mp_preference_id. Unknown outcome until the webhook lands.
 */
export async function resolvePaymentScreenSnapshot(input: {
  admin: AdminClient;
  externalReference: string | null;
  paymentId: string | null;
  preferenceId: string | null;
}): Promise<PaymentScreenResolution> {
  const externalReference = input.externalReference?.trim() || null;
  const paymentId = input.paymentId?.trim() || null;
  const preferenceId = input.preferenceId?.trim() || null;

  if (!externalReference && !paymentId && !preferenceId) {
    return { ok: false, reason: "not_found" };
  }

  let session: PublicCheckoutSessionState | null = null;
  let matchedBy: PaymentScreenSnapshot["matched_by"] = null;

  if (externalReference && UUID_RE.test(externalReference)) {
    const { data, error } = await input.admin
      .from("checkout_sessions")
      .select("*")
      .eq("client_mutation_id", externalReference)
      .maybeSingle();
    if (error) return { ok: false, reason: "database" };
    if (data) {
      session = asSessionState(data);
      matchedBy = "external_reference";
    }
  }

  if (!session && paymentId) {
    try {
      const byPayment = await findCheckoutSessionByMpPaymentId({
        admin: input.admin,
        paymentId,
      });
      if (byPayment) {
        session = byPayment;
        matchedBy = "mp_payment_id";
      }
    } catch {
      return { ok: false, reason: "database" };
    }
  }

  if (!session && preferenceId) {
    const { data, error } = await input.admin
      .from("checkout_sessions")
      .select("*")
      .eq("mp_preference_id" as never, preferenceId)
      .maybeSingle();
    if (error) return { ok: false, reason: "database" };
    if (data) {
      session = asSessionState(data);
      matchedBy = "preference_id";
    }
  }

  if (!session) return { ok: false, reason: "not_found" };

  const plan = await loadPlanSnapshot(input.admin, session.plan_id);
  const outcome = mapSessionStatus(session);

  return {
    ok: true,
    snapshot: {
      outcome,
      plan_name: plan.name,
      amount: plan.amount,
      currency: plan.currency,
      masked_email: maskEmail(session.payer_email ?? ""),
      access_email_sent: Boolean(session.onboarding_email_sent_at),
      onboarding_error: session.onboarding_error ?? null,
      matched_by: matchedBy,
    },
  };
}

export function paymentScreenResponseFor(
  resolution: PaymentScreenResolution
): {
  outcome: PaymentScreenOutcome;
  plan_name: string | null;
  amount: number | null;
  currency: string | null;
  masked_email: string | null;
  access_email_sent: boolean;
  onboarding_error: string | null;
} {
  if (!resolution.ok) {
    return {
      outcome: "unknown",
      plan_name: null,
      amount: null,
      currency: null,
      masked_email: null,
      access_email_sent: false,
      onboarding_error: null,
    };
  }
  const snapshot = resolution.snapshot;
  return {
    outcome: snapshot.outcome,
    plan_name: snapshot.plan_name,
    amount: snapshot.amount,
    currency: snapshot.currency,
    masked_email: snapshot.masked_email,
    access_email_sent: snapshot.access_email_sent,
    // Normalize internal codes to a single safe marker for the public screen.
    onboarding_error: snapshot.onboarding_error ? "onboarding_pending" : null,
  };
}

// Re-export keeps the email normalizer near its only public consumer.
export { normalizeCheckoutSessionEmail };

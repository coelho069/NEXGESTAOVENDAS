/**
 * Server layer for public visitor checkout sessions (SaaS subscriptions).
 * Pre-payment: creates a pending checkout_session keyed by client_mutation_id
 * (unique). Post-webhook: resolves the session to run onboarding exactly once.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { createLogger } from "@/lib/observability/logger";

type AdminClient = SupabaseClient<Database>;

export type PublicCheckoutSessionRow = Database["public"]["Tables"]["checkout_sessions"]["Row"];

/**
 * The claim migration is intentionally kept separate from the generated
 * snapshot until it is applied. Runtime rows include these fields after that
 * migration, while the pre-migration TypeScript snapshot does not.
 */
export type PublicCheckoutSessionState = PublicCheckoutSessionRow & {
  mp_preapproval_id: string | null;
  onboarding_claim_token: string | null;
  onboarding_claimed_at: string | null;
  onboarding_attempt_count: number;
};

type RpcError = { code?: string | null; message?: string | null } | null;

type UntypedRpcClient = {
  rpc(
    functionName: string,
    args: Record<string, unknown>
  ): Promise<{ data: unknown; error: RpcError }>;
};

function asUntypedRpcClient(admin: AdminClient): UntypedRpcClient {
  return admin as unknown as UntypedRpcClient;
}

function asSessionState(value: unknown): PublicCheckoutSessionState {
  return value as PublicCheckoutSessionState;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function normalizeCheckoutSessionEmail(value: string): string {
  return value.trim().toLowerCase();
}

export type CreatePublicCheckoutSessionResult =
  | {
      ok: true;
      sessionId: string;
      clientMutationId: string;
      replayed: boolean;
    }
  | { ok: false; error: string; status: number };

type DbFailureLogInput = {
  operation: string;
  table: string;
  code?: string | null;
  message?: string | null;
  correlationId?: string;
};

// Temporary sanitized diagnostics for the public-checkout 503 investigation.
// Never logs tokens/keys/secrets: the structured logger redacts sensitive
// strings; only PostgREST error code/short message (already sanitized) pass.
export function logCheckoutSessionDbFailure(input: DbFailureLogInput): void {
  createLogger({
    service: "nexgestaovendas",
    route: "subscriptions.mercadopago.public-checkout",
    correlationId: input.correlationId,
  }).error("checkout_session_db_error", {
    operation: input.operation,
    table: input.table,
    db_error_code: input.code ?? null,
    db_message: (input.message ?? "").slice(0, 240) || null,
  });
}

export async function createPublicCheckoutSession(input: {
  admin: AdminClient;
  planId: string;
  payerEmail: string;
  clientMutationId: string;
  correlationId?: string;
}): Promise<CreatePublicCheckoutSessionResult> {
  // Idempotency: a second POST with the same client_mutation_id returns the
  // original session instead of creating a new checkout intent.
  const { data: existing, error: existingError } = await input.admin
    .from("checkout_sessions")
    .select("id, client_mutation_id")
    .eq("client_mutation_id", input.clientMutationId)
    .maybeSingle();

  if (existingError) {
    logCheckoutSessionDbFailure({
      operation: "checkout_sessions.select.maybe_single",
      table: "checkout_sessions",
      code: existingError.code,
      message: existingError.message,
      correlationId: input.correlationId,
    });
    return { ok: false, error: "checkout_session_lookup_failed", status: 503 };
  }
  if (existing) {
    return {
      ok: true,
      sessionId: existing.id,
      clientMutationId: existing.client_mutation_id,
      replayed: true,
    };
  }

  const { data, error } = await input.admin
    .from("checkout_sessions")
    .insert({
      client_mutation_id: input.clientMutationId,
      plan_id: input.planId,
      payer_email: input.payerEmail,
      status: "pending",
    })
    .select("id, client_mutation_id")
    .single();

  if (error || !data) {
    logCheckoutSessionDbFailure({
      operation: "checkout_sessions.insert.single",
      table: "checkout_sessions",
      code: error?.code,
      message: error?.message,
      correlationId: input.correlationId,
    });
    // Race with a concurrent identical insert: treat as replay.
    if (error?.code === "23505") {
      const { data: raced } = await input.admin
        .from("checkout_sessions")
        .select("id, client_mutation_id")
        .eq("client_mutation_id", input.clientMutationId)
        .maybeSingle();
      if (raced) {
        return {
          ok: true,
          sessionId: raced.id,
          clientMutationId: raced.client_mutation_id,
          replayed: true,
        };
      }
    }
    return { ok: false, error: "checkout_session_insert_failed", status: 503 };
  }

  return {
    ok: true,
    sessionId: data.id,
    clientMutationId: data.client_mutation_id,
    replayed: false,
  };
}
export type ResolveSessionForOnboardingResult =
  | {
      ok: true;
      session: PublicCheckoutSessionState;
    }
  | { ok: false; error: string; status: number };

export async function resolveSessionForOnboarding(input: {
  admin: AdminClient;
  clientMutationId: string;
  correlationId?: string;
}): Promise<ResolveSessionForOnboardingResult> {
  const { data, error } = await input.admin
    .from("checkout_sessions")
    .select("*")
    .eq("client_mutation_id", input.clientMutationId)
    .maybeSingle();

  if (error) {
    logCheckoutSessionDbFailure({
      operation: "checkout_sessions.select.maybe_single",
      table: "checkout_sessions",
      code: error.code,
      message: error.message,
      correlationId: input.correlationId,
    });
    return { ok: false, error: "checkout_session_lookup_failed", status: 503 };
  }
  if (!data) {
    return { ok: false, error: "checkout_session_not_found", status: 404 };
  }
  return { ok: true, session: asSessionState(data) };
}

export type PublicCheckoutSessionResolution =
  | {
      ok: true;
      session: PublicCheckoutSessionState;
      matchedBy: "external_reference" | "preapproval_id" | "plan_email";
    }
  | {
      ok: false;
      reason: "not_found" | "ambiguous" | "conflict" | "invalid" | "database";
      error: string;
    };

function logSessionResolution(
  correlationId: string | undefined,
  message: string,
  fields: Record<string, unknown> = {}
): void {
  createLogger({
    service: "nexgestaovendas",
    route: "subscriptions.mercadopago.webhook",
    correlationId,
  }).warn(message, fields);
}

async function findLocalPlanIdForMercadoPagoPlan(input: {
  admin: AdminClient;
  preapprovalPlanId: string;
  correlationId?: string;
}): Promise<{ id: string } | { error: "database" | "not_found" }> {
  const { data, error } = await input.admin
    .from("plans")
    .select("id")
    .eq("mp_preapproval_plan_id", input.preapprovalPlanId)
    .maybeSingle();

  if (error) {
    logCheckoutSessionDbFailure({
      operation: "plans.select.mp_preapproval_plan_id",
      table: "plans",
      code: error.code,
      message: error.message,
      correlationId: input.correlationId,
    });
    return { error: "database" };
  }
  if (!data) return { error: "not_found" };
  return { id: data.id };
}

function sessionMatchesProviderDetails(input: {
  session: PublicCheckoutSessionState;
  localPlanId?: string;
  payerEmail?: string | null;
}): boolean {
  if (input.localPlanId && input.session.plan_id !== input.localPlanId) return false;
  if (
    input.payerEmail &&
    normalizeCheckoutSessionEmail(input.session.payer_email) !==
      normalizeCheckoutSessionEmail(input.payerEmail)
  ) {
    return false;
  }
  return true;
}

/**
 * Resolves a provider preapproval to exactly one public checkout session.
 * Email is never sufficient by itself: the local Mercado Pago plan id and an
 * open session state are required, and two candidates are rejected.
 */
export async function resolvePublicCheckoutSession(input: {
  admin: AdminClient;
  preapprovalId: string;
  clientMutationId?: string | null;
  preapprovalPlanId?: string | null;
  payerEmail?: string | null;
  correlationId?: string;
}): Promise<PublicCheckoutSessionResolution> {
  const normalizedPreapprovalId = input.preapprovalId.trim();
  if (!normalizedPreapprovalId) {
    return { ok: false, reason: "invalid", error: "preapproval_id_required" };
  }

  let localPlanId: string | undefined;
  const ensureLocalPlanId = async (): Promise<"ok" | "database" | "not_found"> => {
    if (!input.preapprovalPlanId?.trim()) return "ok";
    if (localPlanId) return "ok";
    const localPlan = await findLocalPlanIdForMercadoPagoPlan({
      admin: input.admin,
      preapprovalPlanId: input.preapprovalPlanId.trim(),
      correlationId: input.correlationId,
    });
    if ("error" in localPlan) return localPlan.error;
    localPlanId = localPlan.id;
    return "ok";
  };

  if (input.clientMutationId?.trim()) {
    const exact = await input.admin
      .from("checkout_sessions")
      .select("*")
      .eq("client_mutation_id", input.clientMutationId.trim())
      .maybeSingle();
    if (exact.error) {
      logCheckoutSessionDbFailure({
        operation: "checkout_sessions.select.external_reference",
        table: "checkout_sessions",
        code: exact.error.code,
        message: exact.error.message,
        correlationId: input.correlationId,
      });
      return { ok: false, reason: "database", error: "checkout_session_lookup_failed" };
    }
    if (exact.data) {
      const planLookup = await ensureLocalPlanId();
      if (planLookup !== "ok") {
        return {
          ok: false,
          reason: planLookup === "database" ? "database" : "not_found",
          error: planLookup === "database" ? "plan_lookup_failed" : "plan_not_found",
        };
      }
      const session = asSessionState(exact.data);
      if (
        !sessionMatchesProviderDetails({
          session,
          localPlanId,
          payerEmail: input.payerEmail,
        })
      ) {
        logSessionResolution(input.correlationId, "public_checkout_reference_conflict");
        return { ok: false, reason: "conflict", error: "checkout_session_reference_conflict" };
      }
      return { ok: true, session, matchedBy: "external_reference" };
    }
    logSessionResolution(input.correlationId, "public_checkout_reference_not_found");
  }

  const byPreapproval = await input.admin
    .from("checkout_sessions")
    .select("*")
    .eq("mp_preapproval_id" as never, normalizedPreapprovalId)
    .maybeSingle();
  if (byPreapproval.error) {
    logCheckoutSessionDbFailure({
      operation: "checkout_sessions.select.mp_preapproval_id",
      table: "checkout_sessions",
      code: byPreapproval.error.code,
      message: byPreapproval.error.message,
      correlationId: input.correlationId,
    });
    return { ok: false, reason: "database", error: "checkout_session_provider_lookup_failed" };
  }
  if (byPreapproval.data) {
    const planLookup = await ensureLocalPlanId();
    if (planLookup !== "ok") {
      return {
        ok: false,
        reason: planLookup === "database" ? "database" : "not_found",
        error: planLookup === "database" ? "plan_lookup_failed" : "plan_not_found",
      };
    }
    const session = asSessionState(byPreapproval.data);
    if (
      !sessionMatchesProviderDetails({
        session,
        localPlanId,
        payerEmail: input.payerEmail,
      })
    ) {
      logSessionResolution(input.correlationId, "public_checkout_provider_reference_conflict");
      return { ok: false, reason: "conflict", error: "checkout_session_provider_conflict" };
    }
    return { ok: true, session, matchedBy: "preapproval_id" };
  }

  const planLookup = await ensureLocalPlanId();
  if (planLookup !== "ok") {
    if (planLookup === "database") {
      return { ok: false, reason: "database", error: "plan_lookup_failed" };
    }
    logSessionResolution(input.correlationId, "public_checkout_plan_not_found");
    return { ok: false, reason: "not_found", error: "plan_not_found" };
  }

  const normalizedEmail = input.payerEmail
    ? normalizeCheckoutSessionEmail(input.payerEmail)
    : "";
  if (!localPlanId || !normalizedEmail) {
    logSessionResolution(input.correlationId, "public_checkout_resolution_data_missing", {
      has_plan_id: Boolean(localPlanId),
      has_payer_email: Boolean(normalizedEmail),
    });
    return { ok: false, reason: "not_found", error: "checkout_session_not_found" };
  }

  const candidates = await input.admin
    .from("checkout_sessions")
    .select("*")
    .eq("plan_id", localPlanId)
    .eq("payer_email", normalizedEmail)
    .in("status", ["pending", "failed"])
    .or("onboarding_status.is.null,onboarding_status.eq.in_progress,onboarding_status.eq.failed")
    .order("created_at", { ascending: false })
    .limit(2);
  if (candidates.error) {
    logCheckoutSessionDbFailure({
      operation: "checkout_sessions.select.plan_email",
      table: "checkout_sessions",
      code: candidates.error.code,
      message: candidates.error.message,
      correlationId: input.correlationId,
    });
    return { ok: false, reason: "database", error: "checkout_session_lookup_failed" };
  }

  const rows = (candidates.data ?? []).map(asSessionState);
  if (rows.length === 0) {
    logSessionResolution(input.correlationId, "public_checkout_session_not_found", {
      match: "plan_email",
    });
    return { ok: false, reason: "not_found", error: "checkout_session_not_found" };
  }
  if (rows.length > 1) {
    logSessionResolution(input.correlationId, "public_checkout_session_ambiguous", {
      match: "plan_email",
      candidate_count: rows.length,
    });
    return { ok: false, reason: "ambiguous", error: "checkout_session_ambiguous" };
  }

  return { ok: true, session: rows[0], matchedBy: "plan_email" };
}

export type CheckoutSessionClaimResult =
  | {
      ok: true;
      status: "claimed" | "completed";
      replay: boolean;
      claimToken: string | null;
      session: PublicCheckoutSessionState;
    }
  | {
      ok: false;
      status: "busy" | "conflict" | "database";
      error: string;
    };

export async function claimPublicCheckoutSession(input: {
  admin: AdminClient;
  session: PublicCheckoutSessionState;
  preapprovalId: string;
  correlationId?: string;
}): Promise<CheckoutSessionClaimResult> {
  const claimToken = crypto.randomUUID();
  const { data, error } = await asUntypedRpcClient(input.admin).rpc(
    "claim_checkout_session_onboarding",
    {
      p_client_mutation_id: input.session.client_mutation_id,
      p_preapproval_id: input.preapprovalId,
      p_claim_token: claimToken,
    }
  );
  if (error) {
    logCheckoutSessionDbFailure({
      operation: "rpc.claim_checkout_session_onboarding",
      table: "checkout_sessions",
      code: error.code,
      message: error.message,
      correlationId: input.correlationId,
    });
    return { ok: false, status: "database", error: "checkout_session_claim_failed" };
  }

  const payload = asRecord(data);
  const status = payload.status;
  if (status === "busy") {
    logSessionResolution(input.correlationId, "public_checkout_session_claim_busy");
    return { ok: false, status: "busy", error: "checkout_session_claim_busy" };
  }
  if (status === "conflict") {
    logSessionResolution(input.correlationId, "public_checkout_session_claim_conflict");
    return { ok: false, status: "conflict", error: "checkout_session_claim_conflict" };
  }
  if (status !== "claimed" && status !== "completed") {
    return { ok: false, status: "database", error: "checkout_session_claim_invalid" };
  }

  const session = asSessionState({
    ...input.session,
    onboarding_status: status === "completed" ? "completed" : "in_progress",
    onboarding_organization_id:
      asNullableString(payload.organization_id) ?? input.session.onboarding_organization_id,
    onboarding_user_id: asNullableString(payload.user_id) ?? input.session.onboarding_user_id,
    onboarding_subscription_id:
      asNullableString(payload.subscription_id) ?? input.session.onboarding_subscription_id,
    onboarding_email_sent_at:
      payload.email_sent === true
        ? input.session.onboarding_email_sent_at ?? new Date().toISOString()
        : input.session.onboarding_email_sent_at,
    mp_preapproval_id:
      asNullableString(payload.mp_preapproval_id) ?? input.session.mp_preapproval_id,
  });
  return {
    ok: true,
    status,
    replay: payload.replay === true,
    claimToken: status === "claimed" ? claimToken : null,
    session,
  };
}

export type CheckoutSessionProgressResult =
  | {
      ok: true;
      status: "in_progress" | "failed" | "completed";
      replay: boolean;
      session: PublicCheckoutSessionState;
    }
  | { ok: false; status: "busy" | "database"; error: string };

export async function savePublicCheckoutSessionProgress(input: {
  admin: AdminClient;
  session: PublicCheckoutSessionState;
  claimToken: string;
  organizationId?: string | null;
  userId?: string | null;
  subscriptionId?: string | null;
  emailSent?: boolean;
  complete?: boolean;
  onboardingError?: string | null;
  correlationId?: string;
}): Promise<CheckoutSessionProgressResult> {
  const { data, error } = await asUntypedRpcClient(input.admin).rpc(
    "save_checkout_session_onboarding",
    {
      p_client_mutation_id: input.session.client_mutation_id,
      p_claim_token: input.claimToken,
      p_organization_id: input.organizationId ?? null,
      p_user_id: input.userId ?? null,
      p_subscription_id: input.subscriptionId ?? null,
      p_email_sent: input.emailSent === true,
      p_complete: input.complete === true,
      p_onboarding_error: input.onboardingError ?? null,
    }
  );
  if (error) {
    logCheckoutSessionDbFailure({
      operation: "rpc.save_checkout_session_onboarding",
      table: "checkout_sessions",
      code: error.code,
      message: error.message,
      correlationId: input.correlationId,
    });
    return { ok: false, status: "database", error: "checkout_session_progress_failed" };
  }

  const payload = asRecord(data);
  const status = payload.status;
  if (status === "busy") {
    logSessionResolution(input.correlationId, "public_checkout_session_claim_lost");
    return { ok: false, status: "busy", error: "checkout_session_claim_lost" };
  }
  if (status !== "in_progress" && status !== "failed" && status !== "completed") {
    return { ok: false, status: "database", error: "checkout_session_progress_invalid" };
  }

  return {
    ok: true,
    status,
    replay: payload.replay === true,
    session: asSessionState({
      ...input.session,
      onboarding_status: status,
      status: status === "completed" ? "onboarded" : status === "failed" ? "failed" : "pending",
      onboarding_organization_id:
        asNullableString(payload.organization_id) ?? input.organizationId ?? input.session.onboarding_organization_id,
      onboarding_user_id:
        asNullableString(payload.user_id) ?? input.userId ?? input.session.onboarding_user_id,
      onboarding_subscription_id:
        asNullableString(payload.subscription_id) ??
        input.subscriptionId ??
        input.session.onboarding_subscription_id,
      onboarding_email_sent_at:
        payload.email_sent === true
          ? input.session.onboarding_email_sent_at ?? new Date().toISOString()
          : input.session.onboarding_email_sent_at,
      onboarding_error: input.onboardingError ?? input.session.onboarding_error,
    }),
  };
}

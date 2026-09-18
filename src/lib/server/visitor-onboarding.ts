/**
 * Post-confirmation onboarding for public visitor checkouts (SaaS).
 * Runs ONLY from the Mercado Pago webhook path after the provider confirms the
 * subscription. Uses the checkout-session claim/lease and checkpoint RPCs to
 * prevent concurrent provisioning and resume partial attempts safely.
 *
 * Security invariants:
 * - The temporary password is generated here, embedded in a single email,
 *   and never logged nor stored in plaintext (Supabase auth hashes it).
 * - Onboarding failure is recorded (onboarding_status='failed') so the next
 *   webhook retry can re-run provisioning; success never re-runs.
 */
import { createHmac } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { createLogger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailSenderConfig, sendAccessEmail } from "@/lib/server/access-email";
import {
  addBillingPeriodStart,
  formatDateOnlyUtc,
} from "@/lib/domain/mercadopago-assinaturas";
import {
  claimPublicCheckoutSession,
  resolveSessionForOnboarding,
  savePublicCheckoutSessionProgress,
  type PublicCheckoutSessionState,
} from "@/lib/server/public-checkout-sessions";
import {
  buildAccessEmailContent,
  buildOrganizationDisplayName,
  buildOrganizationSlug,
  generateTemporaryPassword,
} from "@/lib/domain/onboarding-visitor";

const logger = createLogger({ service: "nexgestaovendas", component: "visitor-onboarding" });

function appOrigin(envSource: Record<string, string | undefined> = process.env): string {
  return envSource.APP_ORIGIN?.trim() || "http://localhost:3000";
}

export type VisitorOnboardingOutcome =
  | {
      status: "completed" | "replayed" | "session_not_found" | "missing_email" | "failed";
      organizationId?: string;
      userId?: string;
      subscriptionId?: string;
      retryable?: boolean;
    }
  | { status: "degraded"; error: string; retryable?: boolean };

export type VisitorOnboardingInput = {
  clientMutationId: string;
  /** Confirmed MP preapproval id (already verified against the MP API upstream). */
  providerRef: string;
  correlationId?: string;
  /** Overrides for tests. */
  depsOverride?: {
    admin?: SupabaseClient<Database>;
    env?: Record<string, string | undefined>;
  };
};

type PlanRow = {
  id: string;
  name: string;
  amount: number | string;
  currency: string;
  billing_interval: string;
};

function sanitizeOnboardingError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/^onboarding_[a-z0-9_]+$/i.test(message)) return message.slice(0, 120);
  if (message.includes("duplicate") || message.includes("23505")) {
    return "onboarding_duplicate_resource";
  }
  return "onboarding_provisioning_failed";
}

function generateOnboardingPassword(
  clientMutationId: string,
  envSource: Record<string, string | undefined>
): string {
  const secret =
    envSource.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    envSource.MERCADOPAGO_ASSINATURAS_WEBHOOK_SECRET?.trim() ||
    "";
  if (!secret) return generateTemporaryPassword();

  const digest = createHmac("sha256", secret)
    .update(`nex-public-onboarding:${clientMutationId}`)
    .digest("base64url")
    .replace(/[0O1lI]/g, "x");
  return `N${digest.slice(0, 18)}a9!`;
}

async function findAuthUserByEmail(
  admin: SupabaseClient<Database>,
  email: string
): Promise<{ user: User | null; error?: string }> {
  const perPage = 1000;
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) return { user: null, error: "onboarding_user_lookup_failed" };
    const user = data.users.find(
      (candidate) => candidate.email?.trim().toLowerCase() === email
    );
    if (user) return { user };
    if (data.users.length < perPage) break;
  }
  return { user: null };
}

/**
 * Provisioning steps, in order. If any fails mid-way the error is persisted on
 * the session (onboarding_status='failed' + onboarding_error) and a retry is
 * possible. Provisioning is idempotent per session because the row flips to
 * 'completed' at the end and the RPC refuses to run twice (replay=true).
 */
/**
 * Provisioning is claimed before any external side effects. Each successful
 * step is checkpointed, so retries reuse the recorded resource instead of
 * starting from auth user creation again.
 */
export async function runVisitorOnboarding(
  input: VisitorOnboardingInput
): Promise<VisitorOnboardingOutcome> {
  const onboardingLogger = logger.child({ correlationId: input.correlationId });
  const admin =
    input.depsOverride?.admin ??
    createAdminClient() ??
    (undefined as unknown as SupabaseClient<Database>);
  if (!admin) {
    return { status: "degraded", error: "service_role_unavailable" };
  }

  const resolved = await resolveSessionForOnboarding({
    admin,
    clientMutationId: input.clientMutationId,
    correlationId: input.correlationId,
  });
  if (!resolved.ok) {
    if (resolved.error === "checkout_session_not_found") {
      return { status: "session_not_found" };
    }
    return { status: "degraded", error: resolved.error };
  }

  if (resolved.session.onboarding_status === "completed") {
    return {
      status: "replayed",
      organizationId: resolved.session.onboarding_organization_id ?? undefined,
      userId: resolved.session.onboarding_user_id ?? undefined,
      subscriptionId: resolved.session.onboarding_subscription_id ?? undefined,
    };
  }

  const payerEmail = resolved.session.payer_email?.trim().toLowerCase() || "";
  if (!payerEmail) return { status: "missing_email" };

  const envSource = input.depsOverride?.env ?? process.env;
  const emailConfig = getEmailSenderConfig(envSource);
  if (!emailConfig.configured) {
    return { status: "degraded", error: emailConfig.reason };
  }

  const { data: plan, error: planError } = await admin
    .from("plans")
    .select("id, name, amount, currency, billing_interval")
    .eq("id", resolved.session.plan_id)
    .maybeSingle();
  if (planError) return { status: "degraded", error: "onboarding_plan_lookup_failed" };
  if (!plan) return { status: "degraded", error: "onboarding_plan_not_found" };

  const planRow = plan as PlanRow;
  const claim = await claimPublicCheckoutSession({
    admin,
    session: resolved.session,
    preapprovalId: input.providerRef,
    correlationId: input.correlationId,
  });
  if (!claim.ok) {
    return {
      status: "degraded",
      error: claim.error,
      retryable: claim.status !== "conflict",
    };
  }
  if (claim.status === "completed") {
    return {
      status: "replayed",
      organizationId: claim.session.onboarding_organization_id ?? undefined,
      userId: claim.session.onboarding_user_id ?? undefined,
      subscriptionId: claim.session.onboarding_subscription_id ?? undefined,
    };
  }
  if (!claim.claimToken) {
    return { status: "degraded", error: "onboarding_claim_token_missing" };
  }

  let session: PublicCheckoutSessionState = claim.session;
  let organizationId = session.onboarding_organization_id;
  let userId = session.onboarding_user_id;
  let subscriptionId = session.onboarding_subscription_id;
  let temporaryPassword: string | null = null;

  const saveProgress = async (progress: {
    organizationId?: string | null;
    userId?: string | null;
    subscriptionId?: string | null;
    emailSent?: boolean;
    complete?: boolean;
    onboardingError?: string | null;
  }): Promise<void> => {
    const saved = await savePublicCheckoutSessionProgress({
      admin,
      session,
      claimToken: claim.claimToken as string,
      ...progress,
      correlationId: input.correlationId,
    });
    if (!saved.ok) throw new Error(saved.error);
    session = saved.session;
  };

  try {
    const organizationName = buildOrganizationDisplayName(payerEmail);

    // 1. Reuse the checkpointed auth user, or find it by normalized email
    // before creating one. The password is deterministic for this session,
    // allowing a retry to produce the same email payload without storing it.
    if (!userId) {
      const existingUser = await findAuthUserByEmail(admin, payerEmail);
      if (existingUser.error) throw new Error(existingUser.error);
      if (existingUser.user) {
        userId = existingUser.user.id;
      } else {
        temporaryPassword = generateOnboardingPassword(input.clientMutationId, envSource);
        const { data: created, error: createError } = await admin.auth.admin.createUser({
          email: payerEmail,
          password: temporaryPassword,
          email_confirm: true,
          user_metadata: { full_name: organizationName },
        });
        if (createError || !created.user) {
          throw new Error("onboarding_user_create_failed");
        }
        userId = created.user.id;
      }
      await saveProgress({ userId });
    }

    if (!userId) throw new Error("onboarding_user_missing");

    // 2. Reuse an existing profile's organization when a previous attempt
    // created it before its checkpoint was written.
    const { data: existingProfile, error: profileLookupError } = await admin
      .from("profiles")
      .select("org_id")
      .eq("id", userId)
      .maybeSingle();
    if (profileLookupError) throw new Error("onboarding_profile_lookup_failed");
    if (existingProfile?.org_id) {
      if (organizationId && organizationId !== existingProfile.org_id) {
        throw new Error("onboarding_profile_organization_conflict");
      }
      organizationId = existingProfile.org_id;
      await saveProgress({ organizationId });
    }

    // 3. Organization.
    if (!organizationId) {
      const { data: org, error: orgError } = await admin
        .from("organizations")
        .insert({
          name: organizationName,
          slug: buildOrganizationSlug(payerEmail),
        })
        .select("id")
        .single();
      if (orgError || !org) throw new Error("onboarding_org_create_failed");
      organizationId = org.id;
      await saveProgress({ organizationId });
    }

    const orgId = organizationId;

    // 4. Profile, first store and membership are all reused when present.
    if (!existingProfile) {
      const { error: profileError } = await admin.from("profiles").insert({
        id: userId,
        org_id: orgId,
        full_name: organizationName,
        email: payerEmail,
        default_role: "admin",
      });
      if (profileError && profileError.code !== "23505") {
        throw new Error("onboarding_profile_create_failed");
      }
    }

    const { data: existingStore, error: storeLookupError } = await admin
      .from("stores")
      .select("id")
      .eq("org_id", orgId)
      .eq("code", "MATRIZ")
      .maybeSingle();
    if (storeLookupError) throw new Error("onboarding_store_lookup_failed");

    let storeId = existingStore?.id;
    if (!storeId) {
      const { data: store, error: storeError } = await admin
        .from("stores")
        .insert({ org_id: orgId, name: "Loja principal", code: "MATRIZ" })
        .select("id")
        .single();
      if (storeError || !store) throw new Error("onboarding_store_create_failed");
      storeId = store.id;
    }

    const { data: existingMember, error: memberLookupError } = await admin
      .from("store_members")
      .select("id")
      .eq("store_id", storeId)
      .eq("user_id", userId)
      .maybeSingle();
    if (memberLookupError) throw new Error("onboarding_member_lookup_failed");
    if (!existingMember) {
      const { error: memberError } = await admin.from("store_members").insert({
        org_id: orgId,
        store_id: storeId,
        user_id: userId,
        role: "admin",
      });
      if (memberError && memberError.code !== "23505") {
        throw new Error("onboarding_member_create_failed");
      }
    }

    // 5. Reuse a subscription already created by a partial attempt or by the
    // same provider reference; otherwise create the active subscription.
    const { data: existingSubscription, error: subscriptionLookupError } = await admin
      .from("subscriptions")
      .select("id, org_id, checkout_client_mutation_id, mp_preapproval_id")
      .eq("org_id", orgId)
      .eq("checkout_client_mutation_id", input.clientMutationId)
      .maybeSingle();
    if (subscriptionLookupError) throw new Error("onboarding_subscription_lookup_failed");

    if (existingSubscription) {
      if (
        existingSubscription.mp_preapproval_id &&
        existingSubscription.mp_preapproval_id !== input.providerRef
      ) {
        throw new Error("onboarding_subscription_provider_conflict");
      }
      subscriptionId = existingSubscription.id;
    } else {
      const { data: providerSubscription, error: providerSubscriptionError } = await admin
        .from("subscriptions")
        .select("id, org_id, checkout_client_mutation_id")
        .eq("mp_preapproval_id", input.providerRef)
        .maybeSingle();
      if (providerSubscriptionError) {
        throw new Error("onboarding_provider_subscription_lookup_failed");
      }
      if (providerSubscription) {
        if (
          providerSubscription.org_id !== orgId ||
          providerSubscription.checkout_client_mutation_id !== input.clientMutationId
        ) {
          throw new Error("onboarding_subscription_provider_conflict");
        }
        subscriptionId = providerSubscription.id;
      } else {
        const interval =
          planRow.billing_interval === "yearly" || planRow.billing_interval === "monthly"
            ? planRow.billing_interval
            : null;
        if (!interval) throw new Error("onboarding_invalid_billing_interval");
        const contractedAmount =
          typeof planRow.amount === "number" ? planRow.amount : Number(planRow.amount);
        if (!Number.isFinite(contractedAmount)) {
          throw new Error("onboarding_invalid_plan_amount");
        }
        const periodStart = new Date();
        const periodEnd = addBillingPeriodStart(periodStart, interval);
        const { data: subscription, error: subscriptionError } = await admin
          .from("subscriptions")
          .insert({
            org_id: orgId,
            plan_id: planRow.id,
            status: "active",
            contracted_amount: contractedAmount,
            currency: planRow.currency,
            period_start: formatDateOnlyUtc(periodStart),
            period_end: formatDateOnlyUtc(periodEnd),
            mp_preapproval_id: input.providerRef,
            mp_payer_email: payerEmail,
            checkout_client_mutation_id: input.clientMutationId,
          })
          .select("id")
          .single();
        if (subscriptionError || !subscription) {
          throw new Error("onboarding_subscription_create_failed");
        }
        subscriptionId = subscription.id;
      }
    }
    await saveProgress({ subscriptionId });

    // 6. Email delivery is guarded by the persisted marker and by Resend's
    // deterministic idempotency key. The password is never logged/stored.
    if (!session.onboarding_email_sent_at) {
      if (!temporaryPassword) {
        temporaryPassword = generateOnboardingPassword(input.clientMutationId, envSource);
        const { error: passwordError } = await admin.auth.admin.updateUserById(userId, {
          password: temporaryPassword,
        });
        if (passwordError) throw new Error("onboarding_user_password_update_failed");
      }
      const emailContent = buildAccessEmailContent({
        appOrigin: appOrigin(envSource),
        email: payerEmail,
        temporaryPassword,
        planName: planRow.name,
      });
      const sent = await sendAccessEmail({
        to: payerEmail,
        content: emailContent,
        config: emailConfig,
        idempotencyKey: `nex-onboarding/${input.clientMutationId}`,
      });
      if (!sent.ok) throw new Error("onboarding_access_email_failed");
      await saveProgress({
        organizationId: orgId,
        userId,
        subscriptionId,
        emailSent: true,
      });
    }

    const completed = await savePublicCheckoutSessionProgress({
      admin,
      session,
      claimToken: claim.claimToken,
      organizationId: orgId,
      userId,
      subscriptionId,
      emailSent: true,
      complete: true,
      correlationId: input.correlationId,
    });
    if (!completed.ok) throw new Error(completed.error);

    onboardingLogger.info("visitor_onboarding_completed", {
      client_mutation_id: input.clientMutationId,
      organization_id: orgId,
    });
    return {
      status: completed.replay ? "replayed" : "completed",
      organizationId: orgId,
      userId,
      subscriptionId,
    };
  } catch (error) {
    const errorCode = sanitizeOnboardingError(error);
    const failed = await savePublicCheckoutSessionProgress({
      admin,
      session,
      claimToken: claim.claimToken,
      organizationId,
      userId,
      subscriptionId,
      onboardingError: errorCode,
      correlationId: input.correlationId,
    });
    if (!failed.ok) {
      onboardingLogger.warn("visitor_onboarding_failure_checkpoint_failed", {
        client_mutation_id: input.clientMutationId,
        error_code: failed.error,
      });
    }
    onboardingLogger.warn("visitor_onboarding_failed", {
      client_mutation_id: input.clientMutationId,
      error_code: errorCode,
    });
    return { status: "failed" };
  }
}

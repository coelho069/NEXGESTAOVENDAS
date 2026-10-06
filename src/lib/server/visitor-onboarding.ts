/**
 * Post-confirmation onboarding for public visitor checkouts (SaaS).
 * Runs ONLY from payment webhooks after the provider confirms the subscription.
 * Uses the checkout-session claim/lease and checkpoint RPCs to prevent
 * concurrent provisioning and resume partial attempts safely.
 *
 * Security invariants:
 * - No password is generated or emailed. Access is delivered via a single-use
 *   Supabase link to `/ativar-conta`.
 * - Onboarding failure is recorded (onboarding_status='failed') so the next
 *   webhook retry can re-run provisioning; success never re-runs.
 */
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { createLogger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailSenderConfig, sendAccessEmail } from "@/lib/server/access-email";
import { ACCESS_LINK_TTL_MS, generateAccessLink } from "@/lib/server/access-link";
import {
  markClientAccountAccessEmailFailed,
  markClientAccountAccessEmailSent,
  syncClientAccountAfterPurchase,
} from "@/lib/server/client-account-sync";
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
  buildOrganizationDisplayName,
  buildOrganizationSlug,
  buildTransactionalAccessEmailContent,
  orgHasForeignOpenSubscription,
} from "@/lib/domain/onboarding-visitor";

const logger = createLogger({ service: "nexgestaovendas", component: "visitor-onboarding" });

function appOrigin(envSource: Record<string, string | undefined> = process.env): string {
  return (
    envSource.APP_ORIGIN?.trim() ||
    envSource.APP_URL?.trim() ||
    "http://localhost:3000"
  );
}

export type VisitorOnboardingOutcome =
  | {
      status: "completed" | "replayed" | "session_not_found" | "missing_email" | "failed";
      organizationId?: string;
      userId?: string;
      subscriptionId?: string;
      retryable?: boolean;
      /** Normalized payer email used as Supabase login (never logged with password). */
      loginEmail?: string;
      accessEmailSent?: boolean;
      verifiedUserCreated?: boolean;
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

function supportEmail(envSource: Record<string, string | undefined>): string | null {
  return envSource.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || null;
}

async function organizationHasForeignSubscription(
  admin: SupabaseClient<Database>,
  orgId: string,
  input: { clientMutationId: string; providerRef: string }
): Promise<boolean> {
  const { data, error } = await admin
    .from("subscriptions")
    .select("checkout_client_mutation_id, mp_preapproval_id")
    .eq("org_id", orgId)
    .in("status", ["active", "trialing", "past_due"]);
  if (error) throw new Error("onboarding_subscription_lookup_failed");
  return orgHasForeignOpenSubscription(
    (data ?? []).map((row) => ({
      checkoutClientMutationId: row.checkout_client_mutation_id,
      providerRef: row.mp_preapproval_id,
    })),
    input.clientMutationId,
    input.providerRef
  );
}

async function verifyAuthUserExists(
  admin: SupabaseClient<Database>,
  userId: string
): Promise<boolean> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  return !error && Boolean(data.user?.id);
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
    const replayEmail = resolved.session.payer_email?.trim().toLowerCase() || undefined;
    return {
      status: "replayed",
      organizationId: resolved.session.onboarding_organization_id ?? undefined,
      userId: resolved.session.onboarding_user_id ?? undefined,
      subscriptionId: resolved.session.onboarding_subscription_id ?? undefined,
      loginEmail: replayEmail,
      accessEmailSent: Boolean(resolved.session.onboarding_email_sent_at),
      verifiedUserCreated: false,
    };
  }

  const payerEmail = resolved.session.payer_email?.trim().toLowerCase() || "";
  if (!payerEmail) {
    onboardingLogger.warn("onboarding_email_skipped", {
      client_mutation_id: input.clientMutationId,
      reason: "missing_payer_email",
    });
    return { status: "missing_email" };
  }

  const envSource = input.depsOverride?.env ?? process.env;
  const emailConfig = getEmailSenderConfig(envSource);

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
    const replayEmail = claim.session.payer_email?.trim().toLowerCase() || undefined;
    return {
      status: "replayed",
      organizationId: claim.session.onboarding_organization_id ?? undefined,
      userId: claim.session.onboarding_user_id ?? undefined,
      subscriptionId: claim.session.onboarding_subscription_id ?? undefined,
      loginEmail: replayEmail,
      accessEmailSent: Boolean(claim.session.onboarding_email_sent_at),
      verifiedUserCreated: false,
    };
  }
  if (!claim.claimToken) {
    return { status: "degraded", error: "onboarding_claim_token_missing" };
  }

  let session: PublicCheckoutSessionState = claim.session;
  let organizationId = session.onboarding_organization_id;
  let userId = session.onboarding_user_id;
  let subscriptionId = session.onboarding_subscription_id;
  let accessEmailSent = Boolean(session.onboarding_email_sent_at);
  let verifiedUserCreated = false;
  let clientAccountId: string | null = null;
  let pendingAccessLink: string | null = null;

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

    // 1. Reuse the checkpointed auth user, or provision via a secure access
    // link (invite for new e-mails, recovery for existing logins).
    if (!userId) {
      const existingUser = await findAuthUserByEmail(admin, payerEmail);
      if (existingUser.error) throw new Error(existingUser.error);

      const redirectTo = `${appOrigin(envSource).replace(/\/+$/, "")}/ativar-conta`;
      const link = await generateAccessLink(admin, {
        email: payerEmail,
        redirectTo,
        userExists: Boolean(existingUser.user),
      });
      if (!link.ok) throw new Error("onboarding_user_create_failed");

      userId = link.userId;
      pendingAccessLink = link.actionLink;
      verifiedUserCreated = link.linkType === "invite" && !existingUser.user;

      if (!(await verifyAuthUserExists(admin, userId))) {
        throw new Error("onboarding_auth_user_verify_failed");
      }
      await saveProgress({ userId });
    }

    if (!userId) throw new Error("onboarding_user_missing");

    // 2. Reuse the payer's organization only when it does not already hold
    // another open subscription. A paid checkout stays a client of its own
    // subscription and is not attached to an admin subscription.
    const { data: existingProfile, error: profileLookupError } = await admin
      .from("profiles")
      .select("org_id")
      .eq("id", userId)
      .maybeSingle();
    if (profileLookupError) throw new Error("onboarding_profile_lookup_failed");
    const previousOrgId = existingProfile?.org_id ?? null;
    if (organizationId && (await organizationHasForeignSubscription(admin, organizationId, input))) {
      organizationId = null;
    }
    if (previousOrgId && !organizationId) {
      const foreign = await organizationHasForeignSubscription(admin, previousOrgId, input);
      if (!foreign) {
        organizationId = previousOrgId;
        await saveProgress({ organizationId });
      }
    } else if (previousOrgId && organizationId && organizationId !== previousOrgId) {
      throw new Error("onboarding_profile_organization_conflict");
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
        default_role: "client",
      });
      if (profileError && profileError.code !== "23505") {
        throw new Error("onboarding_profile_create_failed");
      }
    } else if (previousOrgId !== orgId) {
      const { error: profileMoveError } = await admin
        .from("profiles")
        .update({ org_id: orgId, default_role: "client" })
        .eq("id", userId);
      if (profileMoveError) throw new Error("onboarding_profile_create_failed");
      if (previousOrgId) {
        const { error: detachError } = await admin
          .from("store_members")
          .delete()
          .eq("user_id", userId)
          .eq("org_id", previousOrgId);
        if (detachError) throw new Error("onboarding_member_create_failed");
      }
    } else {
      const { error: roleError } = await admin
        .from("profiles")
        .update({ default_role: "client" })
        .eq("id", userId);
      if (roleError) throw new Error("onboarding_profile_create_failed");
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
      .select("id, role")
      .eq("store_id", storeId)
      .eq("user_id", userId)
      .maybeSingle();
    if (memberLookupError) throw new Error("onboarding_member_lookup_failed");
    if (!existingMember) {
      const { error: memberError } = await admin.from("store_members").insert({
        org_id: orgId,
        store_id: storeId,
        user_id: userId,
        role: "client",
      });
      if (memberError && memberError.code !== "23505") {
        throw new Error("onboarding_member_create_failed");
      }
    } else if (existingMember.role !== "client") {
      const { error: memberRoleError } = await admin
        .from("store_members")
        .update({ role: "client" })
        .eq("id", existingMember.id);
      if (memberRoleError) throw new Error("onboarding_member_create_failed");
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

    // 6. Mirror provisioning in client_accounts for admin visibility (best-effort).
    const synced = await syncClientAccountAfterPurchase(admin, {
      userId,
      email: payerEmail,
      fullName: organizationName,
      companyName: organizationName,
      orgId,
      subscriptionId,
      checkoutClientMutationId: input.clientMutationId,
    });
    if (synced.ok) {
      clientAccountId = synced.clientAccountId;
    } else {
      onboardingLogger.warn("client_account_sync_skipped", {
        client_mutation_id: input.clientMutationId,
        error_code: synced.error,
      });
    }

    // 7. Transactional access e-mail — guarded by the persisted sent-at marker.
    // Complete SMTP_* uses Hostinger. Resend is used only when no SMTP_*
    // variable is set, and still receives an idempotency key. SMTP does not.
    // The activation link is never logged.
    if (!session.onboarding_email_sent_at) {
      if (!emailConfig.configured) {
        onboardingLogger.warn("onboarding_email_skipped", {
          client_mutation_id: input.clientMutationId,
          reason: emailConfig.reason,
        });
        if (clientAccountId) {
          await markClientAccountAccessEmailFailed(admin, {
            clientAccountId,
            errorCode: emailConfig.reason,
          });
        }
      } else {
        const redirectTo = `${appOrigin(envSource).replace(/\/+$/, "")}/ativar-conta`;
        let actionLink = pendingAccessLink;
        if (!actionLink) {
          const link = await generateAccessLink(admin, {
            email: payerEmail,
            redirectTo,
            userExists: true,
          });
          if (!link.ok) throw new Error("onboarding_access_email_failed");
          actionLink = link.actionLink;
        }

        const now = Date.now();
        const origin = appOrigin(envSource).replace(/\/+$/, "");
        const emailContent = buildTransactionalAccessEmailContent({
          email: payerEmail,
          fullName: organizationName,
          planName: planRow.name,
          activationUrl: actionLink,
          loginUrl: `${origin}/login`,
          expiresAt: new Date(now + ACCESS_LINK_TTL_MS).toISOString(),
          supportEmail: supportEmail(envSource),
        });
        const sent = await sendAccessEmail({
          to: payerEmail,
          content: emailContent,
          config: emailConfig,
          idempotencyKey: `nex-onboarding/${input.clientMutationId}`,
        });
        if (!sent.ok) {
          if (clientAccountId) {
            await markClientAccountAccessEmailFailed(admin, {
              clientAccountId,
              errorCode: sent.error,
            });
          }
          throw new Error("onboarding_access_email_failed");
        }
        accessEmailSent = true;
        if (clientAccountId) {
          await markClientAccountAccessEmailSent(admin, {
            clientAccountId,
            now,
            isResend: synced.ok ? !synced.created : false,
          });
        }
        await saveProgress({
          organizationId: orgId,
          userId,
          subscriptionId,
          emailSent: true,
        });
      }
    }

    const completed = await savePublicCheckoutSessionProgress({
      admin,
      session,
      claimToken: claim.claimToken,
      organizationId: orgId,
      userId,
      subscriptionId,
      emailSent: accessEmailSent,
      complete: true,
      correlationId: input.correlationId,
    });
    if (!completed.ok) throw new Error(completed.error);

    onboardingLogger.info("visitor_onboarding_completed", {
      client_mutation_id: input.clientMutationId,
      organization_id: orgId,
      access_email_sent: accessEmailSent,
      verified_user_created: verifiedUserCreated,
    });
    return {
      status: completed.replay ? "replayed" : "completed",
      organizationId: orgId,
      userId,
      subscriptionId,
      loginEmail: payerEmail,
      accessEmailSent,
      verifiedUserCreated,
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

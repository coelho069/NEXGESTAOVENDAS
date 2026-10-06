/**
 * Server-side provisioning of client accounts + Gmail invitations.
 *
 * Invariants enforced here (see docs/CLIENT-ACCOUNT-INVITES.md):
 *  - Runs only after getPlatformAdminAccess() succeeds; re-verified per call.
 *  - The privileged Supabase client is the service-role one and is imported
 *    lazily so the key can never leak into a client bundle.
 *  - Idempotent: an e-mail that already owns a client_accounts row is never
 *    provisioned twice, and a failed e-mail never triggers a second account.
 *  - No password is ever generated or sent; activation goes through the
 *    Supabase invite link and the client sets their own password.
 *  - Subscription and payment state are read-only here. Nothing in this module
 *    can mark an invoice as paid or activate a subscription.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { createLogger } from "@/lib/observability/logger";
import { getPlatformAdminAccess } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildAccountInviteEmailContent,
  isClientAccountStatus,
  isPasswordAcceptable,
  normalizeAccountEmail,
  type ClientAccountStatus,
} from "@/lib/domain/admin-client-accounts";
import {
  canDefineActivationPassword,
  describeActivationPasswordError,
} from "@/lib/domain/activation-link";
import { ACCESS_LINK_TTL_MS, generateAccessLink } from "@/lib/server/access-link";
import { getEmailSenderConfig, sendAccessEmail } from "@/lib/server/access-email";
import { getGmailInviteConfig, sendGmailInvite } from "@/lib/server/gmail-invite-sender";
import type {
  CreateAdminClientAccountInput,
  SetAdminClientAccountSuspendedInput,
} from "@/lib/validation/schemas";
import { createAdminClientAccountSchema, setAdminClientAccountSuspendedSchema } from "@/lib/validation/schemas";
import {
  resendAdminClientAccountInviteSchema,
  type ResendAdminClientAccountInviteInput,
} from "@/lib/validation/schemas";

const logger = createLogger({ service: "nexgestaovendas", component: "client-account-provisioning" });

/** Supabase default access-link lifetime is 24h; mirrored here for the UI countdown. */
export const CLIENT_ACCOUNT_INVITE_TTL_MS = ACCESS_LINK_TTL_MS;

export type ClientAccountError =
  | "forbidden"
  | "validation_failed"
  | "email_already_exists"
  | "organization_not_found"
  | "subscription_not_found"
  | "subscription_org_mismatch"
  | "gmail_not_configured"
  | "rate_limited"
  | "account_create_failed"
  | "invite_generation_failed"
  | "invite_send_failed"
  | "account_not_found"
  | "account_not_resendable"
  | "suspension_not_supported"
  | "service_role_unavailable"
  | "unavailable";

export type ClientAccountActionResult =
  | { ok: true; clientAccountId: string; status: ClientAccountStatus; inviteSent: boolean }
  | { ok: false; error: ClientAccountError };

export type ClientAccountActionDeps = {
  admin?: SupabaseClient<Database> | null;
  env?: Record<string, string | undefined>;
  sendInvite?: typeof sendGmailInvite;
  now?: () => number;
};

type ClientAccountRow = Database["public"]["Tables"]["client_accounts"]["Row"];

function appOrigin(envSource: Record<string, string | undefined>): string {
  const raw =
    envSource.APP_ORIGIN?.trim() || envSource.APP_URL?.trim() || "http://localhost:3000";
  return raw;
}

function supportEmail(envSource: Record<string, string | undefined>): string | null {
  return envSource.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || null;
}

async function requirePlatformAdmin(): Promise<
  { ok: true; userId: string; admin: SupabaseClient<Database> } | { ok: false; error: ClientAccountError }
> {
  const access = await getPlatformAdminAccess();
  if (!access) return { ok: false, error: "forbidden" };

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "service_role_unavailable" };

  return { ok: true, userId: access.userId, admin };
}

/** Records an audit event. Failures are logged, never surfaced to the caller. */
async function recordEvent(
  admin: SupabaseClient<Database>,
  input: {
    clientAccountId: string;
    eventType:
      | "account_created"
      | "invite_sent"
      | "invite_resent"
      | "invite_failed"
      | "account_activated"
      | "account_suspended"
      | "account_reactivated";
    actorUserId: string | null;
    errorCode?: string;
  }
): Promise<void> {
  const { error } = await admin.from("client_account_events").insert({
    client_account_id: input.clientAccountId,
    event_type: input.eventType,
    actor_user_id: input.actorUserId,
    error_code: input.errorCode ?? "",
  });
  if (error) {
    logger.warn("client_account_event_record_failed", { error_code: error.code });
  }
}

type ProfileLookup = { id: string; org_id: string; email: string } | null;

/** Finds an existing auth user for the e-mail, if any. Uses the admin client. */
async function findAuthUserIdByEmail(
  admin: SupabaseClient<Database>,
  email: string
): Promise<string | null> {
  // listUsers is paginated; we only need the page containing the address and
  // bounded it to keep the cost predictable on large instances.
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      logger.warn("client_account_user_lookup_failed", { error_code: error.name ?? "unknown" });
      return null;
    }
    const users = data?.users ?? [];
    const match = users.find(
      (user) => (user.email ?? "").toLowerCase() === email.toLowerCase()
    );
    if (match) return match.id;
    if (users.length < 200) break;
  }
  return null;
}

async function readExistingAccountByEmail(
  admin: SupabaseClient<Database>,
  email: string
): Promise<ClientAccountRow | null> {
  const { data, error } = await admin
    .from("client_accounts")
    .select("*")
    .ilike("email", email)
    .maybeSingle();
  if (error) return null;
  return data as ClientAccountRow | null;
}

/**
 * Ensures a `profiles` row exists for the user so the PDV can resolve the
 * tenant context. Profiles remain the single source of truth for tenant data.
 */
async function ensureProfile(
  admin: SupabaseClient<Database>,
  input: { userId: string; email: string; fullName: string; orgId: string }
): Promise<{ ok: true } | { ok: false; error: ClientAccountError }> {
  const existing = await admin
    .from("profiles")
    .select("id, org_id, email")
    .eq("id", input.userId)
    .maybeSingle() as { data: ProfileLookup; error: { code?: string } | null };

  if (existing.error) return { ok: false, error: "account_create_failed" };
  if (existing.data) {
    // Never reassign an existing profile to another org: that would move a
    // tenant-owned identity and could widen access.
    return { ok: true };
  }

  const { error } = await admin.from("profiles").insert({
    id: input.userId,
    org_id: input.orgId,
    email: input.email,
    full_name: input.fullName,
    default_role: "client",
  });
  if (error) return { ok: false, error: "account_create_failed" };
  return { ok: true };
}

/**
 * Ensures the invited client can pass tenant RLS (`user_has_org_membership`).
 * Mirrors the visitor-onboarding path: profile + MATRIZ store + store_members.
 */
async function ensureTenantAccess(
  admin: SupabaseClient<Database>,
  input: { userId: string; email: string; fullName: string; orgId: string; companyName: string }
): Promise<{ ok: true } | { ok: false; error: ClientAccountError }> {
  const profile = await ensureProfile(admin, input);
  if (!profile.ok) return profile;

  const storeName = input.companyName.trim() || "Loja principal";

  const { data: existingStore, error: storeLookupError } = await admin
    .from("stores")
    .select("id")
    .eq("org_id", input.orgId)
    .eq("code", "MATRIZ")
    .maybeSingle();
  if (storeLookupError) return { ok: false, error: "account_create_failed" };

  let storeId = existingStore?.id;
  if (!storeId) {
    const { data: store, error: storeError } = await admin
      .from("stores")
      .insert({ org_id: input.orgId, name: storeName, code: "MATRIZ" })
      .select("id")
      .single();
    if (storeError || !store) return { ok: false, error: "account_create_failed" };
    storeId = store.id;
  }

  const { data: existingMember, error: memberLookupError } = await admin
    .from("store_members")
    .select("id")
    .eq("store_id", storeId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (memberLookupError) return { ok: false, error: "account_create_failed" };
  if (existingMember) return { ok: true };

  const { error: memberError } = await admin.from("store_members").insert({
    org_id: input.orgId,
    store_id: storeId,
    user_id: input.userId,
    role: "client",
  });
  if (memberError && memberError.code !== "23505") {
    return { ok: false, error: "account_create_failed" };
  }
  return { ok: true };
}

async function generateInviteLink(
  admin: SupabaseClient<Database>,
  input: { email: string; redirectTo: string }
): Promise<{ ok: true; actionLink: string } | { ok: false; error: ClientAccountError }> {
  const link = await generateAccessLink(admin, input);
  if (!link.ok) return { ok: false, error: "invite_generation_failed" };
  return { ok: true, actionLink: link.actionLink };
}

async function validateSubscriptionLink(
  admin: SupabaseClient<Database>,
  input: { subscriptionId: string; orgId: string }
): Promise<{ ok: true } | { ok: false; error: ClientAccountError }> {
  const { data, error } = await admin
    .from("subscriptions")
    .select("id, org_id")
    .eq("id", input.subscriptionId)
    .maybeSingle();
  if (error) return { ok: false, error: "unavailable" };
  if (!data) return { ok: false, error: "subscription_not_found" };
  if (data.org_id !== input.orgId) return { ok: false, error: "subscription_org_mismatch" };
  return { ok: true };
}

async function resolveOrganization(
  admin: SupabaseClient<Database>,
  orgId: string
): Promise<{ ok: true; name: string } | { ok: false; error: ClientAccountError }> {
  const { data, error } = await admin
    .from("organizations")
    .select("id, name")
    .eq("id", orgId)
    .maybeSingle();
  if (error) return { ok: false, error: "unavailable" };
  if (!data) return { ok: false, error: "organization_not_found" };
  return { ok: true, name: data.name };
}

async function readPlanName(
  admin: SupabaseClient<Database>,
  planId: string | null | undefined
): Promise<string | null> {
  if (!planId) return null;
  const { data } = await admin.from("plans").select("name").eq("id", planId).maybeSingle();
  return data?.name ?? null;
}

async function markInviteSent(
  admin: SupabaseClient<Database>,
  input: { clientAccountId: string; now: number }
): Promise<void> {
  const expiresAt = new Date(input.now + CLIENT_ACCOUNT_INVITE_TTL_MS).toISOString();
  await admin
    .from("client_accounts")
    .update({
      status: "invite_sent",
      invite_sent_at: new Date(input.now).toISOString(),
      invite_expires_at: expiresAt,
      last_error: "",
    })
    .eq("id", input.clientAccountId);
}

async function markInviteFailed(
  admin: SupabaseClient<Database>,
  input: { clientAccountId: string; status: ClientAccountStatus; errorCode: string }
): Promise<void> {
  await admin
    .from("client_accounts")
    .update({ status: input.status, last_error: input.errorCode })
    .eq("id", input.clientAccountId);
}

/**
 * Gmail OAuth is used only when it is explicitly configured. Otherwise the
 * invite goes through the same sender as post-purchase onboarding (Hostinger
 * SMTP, or Resend when no SMTP variable is set).
 */
async function dispatchInviteEmail(input: {
  env: Record<string, string | undefined>;
  sendInvite: typeof sendGmailInvite;
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: true } | { ok: false; error: string; notConfigured: boolean }> {
  const gmail = getGmailInviteConfig(input.env);
  if (gmail.configured) {
    const sent = await input.sendInvite({
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      config: gmail,
    });
    return sent.ok ? { ok: true } : { ok: false, error: sent.error, notConfigured: false };
  }

  const emailConfig = getEmailSenderConfig(input.env);
  if (!emailConfig.configured) {
    return { ok: false, error: gmail.reason, notConfigured: true };
  }

  const sent = await sendAccessEmail({
    to: input.to,
    content: { subject: input.subject, html: input.html, text: input.text },
    config: emailConfig,
  });
  return sent.ok
    ? { ok: true }
    : { ok: false, error: sent.error, notConfigured: false };
}

/**
 * Sends (or re-sends) the activation e-mail for an already-provisioned account.
 * Shared by create and resend so both flows produce identical state transitions.
 */
async function deliverInvite(
  admin: SupabaseClient<Database>,
  input: {
    clientAccountId: string;
    email: string;
    fullName: string;
    companyName: string;
    planName: string | null;
    isResend: boolean;
    actorUserId: string;
    env: Record<string, string | undefined>;
    sendInvite: typeof sendGmailInvite;
    now: number;
  }
): Promise<ClientAccountActionResult> {
  const redirectTo = `${appOrigin(input.env).replace(/\/+$/, "")}/ativar-conta`;
  const link = await generateInviteLink(admin, { email: input.email, redirectTo });
  if (!link.ok) {
    await markInviteFailed(admin, {
      clientAccountId: input.clientAccountId,
      status: "invite_failed",
      errorCode: link.error,
    });
    await recordEvent(admin, {
      clientAccountId: input.clientAccountId,
      eventType: "invite_failed",
      actorUserId: input.actorUserId,
      errorCode: link.error,
    });
    return { ok: false, error: link.error };
  }

  let content;
  try {
    content = buildAccountInviteEmailContent({
      fullName: input.fullName,
      email: input.email,
      companyName: input.companyName,
      planName: input.planName,
      activationUrl: link.actionLink,
      expiresAt: new Date(input.now + CLIENT_ACCOUNT_INVITE_TTL_MS).toISOString(),
      supportEmail: supportEmail(input.env),
    });
  } catch {
    // Rejected origin or URL: fail closed, never deliver a broken link.
    await markInviteFailed(admin, {
      clientAccountId: input.clientAccountId,
      status: "invite_failed",
      errorCode: "activation_url_invalid",
    });
    return { ok: false, error: "invite_send_failed" };
  }

  const sent = await dispatchInviteEmail({
    env: input.env,
    sendInvite: input.sendInvite,
    to: input.email,
    subject: content.subject,
    html: content.html,
    text: content.text,
  });

  if (!sent.ok) {
    // The account already exists at this point: it is deliberately preserved so
    // a retry re-sends the invitation instead of provisioning a second user.
    await markInviteFailed(admin, {
      clientAccountId: input.clientAccountId,
      status: "invite_failed",
      errorCode: sent.error,
    });
    await recordEvent(admin, {
      clientAccountId: input.clientAccountId,
      eventType: "invite_failed",
      actorUserId: input.actorUserId,
      errorCode: sent.error,
    });
    logger.warn(
      sent.notConfigured ? "client_account_invite_not_configured" : "client_account_invite_failed",
      { error_code: sent.error }
    );
    return { ok: false, error: sent.notConfigured ? "gmail_not_configured" : "invite_send_failed" };
  }

  await markInviteSent(admin, { clientAccountId: input.clientAccountId, now: input.now });
  await recordEvent(admin, {
    clientAccountId: input.clientAccountId,
    eventType: input.isResend ? "invite_resent" : "invite_sent",
    actorUserId: input.actorUserId,
  });

  logger.info("client_account_invite_delivered", {
    client_account_id: input.clientAccountId,
    resent: input.isResend,
  });

  const { data } = await admin
    .from("client_accounts")
    .select("status")
    .eq("id", input.clientAccountId)
    .maybeSingle();

  return {
    ok: true,
    clientAccountId: input.clientAccountId,
    status: (data?.status as ClientAccountStatus) ?? "invite_sent",
    inviteSent: true,
  };
}

/**
 * Creates a client account and (optionally) sends the Gmail invitation.
 *
 * Idempotency: the unique index on lower(email) is the source of truth. A
 * repeated request for the same e-mail returns the existing account and only
 * retries delivery — it never provisions a second auth user.
 */
export async function createAdminClientAccountAction(
  raw: unknown,
  deps: ClientAccountActionDeps = {}
): Promise<ClientAccountActionResult> {
  const parsed = createAdminClientAccountSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "validation_failed" };

  const auth = await requirePlatformAdmin();
  if (!auth.ok) return auth;

  const admin = deps.admin ?? auth.admin;
  const env = deps.env ?? process.env;
  const sendInvite = deps.sendInvite ?? sendGmailInvite;
  const now = deps.now?.() ?? Date.now();
  const input: CreateAdminClientAccountInput = parsed.data;
  const email = normalizeAccountEmail(input.email);

  const org = await resolveOrganization(admin, input.org_id);
  if (!org.ok) return org;

  if (input.subscription_id) {
    const link = await validateSubscriptionLink(admin, {
      subscriptionId: input.subscription_id,
      orgId: input.org_id,
    });
    if (!link.ok) return link;
  }

  // Duplicate guard before any write: avoids leaking whether the address exists
  // through a generic "already exists" error, while keeping the flow idempotent.
  const existingAccount = await readExistingAccountByEmail(admin, email);
  if (existingAccount) {
    if (!input.send_invite) {
      return {
        ok: true,
        clientAccountId: existingAccount.id,
        status: existingAccount.status,
        inviteSent: false,
      };
    }
    const planName = await readPlanNameForAccount(admin, existingAccount);
    const result = await deliverInvite(admin, {
      clientAccountId: existingAccount.id,
      email,
      fullName: existingAccount.full_name,
      companyName: existingAccount.company_name,
      planName,
      isResend: true,
      actorUserId: auth.userId,
      env,
      sendInvite,
      now,
    });
    return result;
  }

  const existingUserId = await findAuthUserIdByEmail(admin, email);
  if (existingUserId) {
    // The login exists (e.g. provisioned by an earlier attempt or by the
    // public checkout) but was never tracked here. Reuse the login instead of
    // creating a second one, and link it to this organization.
    const { data: linked, error: linkError } = await admin
      .from("client_accounts")
      .insert({
        user_id: existingUserId,
        org_id: input.org_id,
        subscription_id: input.subscription_id ?? null,
        email,
        full_name: input.full_name,
        company_name: input.company_name,
        status: "created",
        created_by: auth.userId,
      })
      .select("id")
      .single();
    if (linkError || !linked) {
      logger.warn("client_account_link_failed", { error_code: linkError?.code ?? "unknown" });
      return { ok: false, error: "email_already_exists" };
    }

    const tenant = await ensureTenantAccess(admin, {
      userId: existingUserId,
      email,
      fullName: input.full_name,
      orgId: input.org_id,
      companyName: input.company_name,
    });
    if (!tenant.ok) return tenant;

    await recordEvent(admin, {
      clientAccountId: linked.id,
      eventType: "account_created",
      actorUserId: auth.userId,
    });

    if (!input.send_invite) {
      return { ok: true, clientAccountId: linked.id, status: "created", inviteSent: false };
    }

    return deliverInvite(admin, {
      clientAccountId: linked.id,
      email,
      fullName: input.full_name,
      companyName: input.company_name,
      planName: await readPlanNameForSubscription(admin, input.subscription_id),
      isResend: false,
      actorUserId: auth.userId,
      env,
      sendInvite,
      now,
    });
  }

  // Fully new login. generateLink(type=invite) creates the unconfirmed user
  // server-side; no password is ever generated or stored by this application.
  const redirectTo = `${appOrigin(env).replace(/\/+$/, "")}/ativar-conta`;
  const link = await generateInviteLink(admin, { email, redirectTo });
  if (!link.ok) return link;

  const userId = await resolveGeneratedLinkUserId(admin, email);
  if (!userId) return { ok: false, error: "account_create_failed" };

  const tenant = await ensureTenantAccess(admin, {
    userId,
    email,
    fullName: input.full_name,
    orgId: input.org_id,
    companyName: input.company_name,
  });
  if (!tenant.ok) return tenant;

  const { data: created, error: insertError } = await admin
    .from("client_accounts")
    .insert({
      user_id: userId,
      org_id: input.org_id,
      subscription_id: input.subscription_id ?? null,
      email,
      full_name: input.full_name,
      company_name: input.company_name,
      status: input.send_invite ? "invite_pending" : "created",
      created_by: auth.userId,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    logger.warn("client_account_insert_failed", { error_code: insertError?.code ?? "unknown" });
    return { ok: false, error: "account_create_failed" };
  }

  await recordEvent(admin, {
    clientAccountId: created.id,
    eventType: "account_created",
    actorUserId: auth.userId,
  });
  logger.info("client_account_created", { client_account_id: created.id });

  if (!input.send_invite) {
    return { ok: true, clientAccountId: created.id, status: "created", inviteSent: false };
  }

  const content = buildAccountInviteEmailContent({
    fullName: input.full_name,
    email,
    companyName: input.company_name,
    planName: await readPlanNameForSubscription(admin, input.subscription_id),
    activationUrl: link.actionLink,
    expiresAt: new Date(now + CLIENT_ACCOUNT_INVITE_TTL_MS).toISOString(),
    supportEmail: supportEmail(env),
  });
  const sent = await dispatchInviteEmail({
    env,
    sendInvite,
    to: email,
    subject: content.subject,
    html: content.html,
    text: content.text,
  });
  if (!sent.ok) {
    await markInviteFailed(admin, {
      clientAccountId: created.id,
      status: "invite_failed",
      errorCode: sent.error,
    });
    await recordEvent(admin, {
      clientAccountId: created.id,
      eventType: "invite_failed",
      actorUserId: auth.userId,
      errorCode: sent.error,
    });
    logger.warn(
      sent.notConfigured ? "client_account_invite_not_configured" : "client_account_invite_failed",
      { error_code: sent.error }
    );
    return { ok: false, error: sent.notConfigured ? "gmail_not_configured" : "invite_send_failed" };
  }

  await markInviteSent(admin, { clientAccountId: created.id, now });
  await recordEvent(admin, {
    clientAccountId: created.id,
    eventType: "invite_sent",
    actorUserId: auth.userId,
  });
  logger.info("client_account_invite_delivered", { client_account_id: created.id });

  return { ok: true, clientAccountId: created.id, status: "invite_sent", inviteSent: true };
}

/** Resolves the plan name for an existing account row via its subscription. */
async function readPlanNameForAccount(
  admin: SupabaseClient<Database>,
  account: ClientAccountRow
): Promise<string | null> {
  return readPlanNameForSubscription(admin, account.subscription_id);
}

async function readPlanNameForSubscription(
  admin: SupabaseClient<Database>,
  subscriptionId: string | null | undefined
): Promise<string | null> {
  if (!subscriptionId) return null;
  const { data } = await admin
    .from("subscriptions")
    .select("plan_id")
    .eq("id", subscriptionId)
    .maybeSingle();
  return readPlanName(admin, data?.plan_id ?? null);
}

/**
 * `generateLink` returns the new user payload; fall back to an e-mail lookup so
 * the flow stays correct even if a future Supabase version omits it.
 */
async function resolveGeneratedLinkUserId(
  admin: SupabaseClient<Database>,
  email: string
): Promise<string | null> {
  return findAuthUserIdByEmail(admin, email);
}

/**
 * Re-sends the invitation. Refused once the account is activated or suspended,
 * which prevents pointless mail to users who no longer need it.
 */
export async function resendAdminClientAccountInviteAction(
  raw: unknown,
  deps: ClientAccountActionDeps = {}
): Promise<ClientAccountActionResult> {
  const parsed = resendAdminClientAccountInviteSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "validation_failed" };

  const auth = await requirePlatformAdmin();
  if (!auth.ok) return auth;

  const admin = deps.admin ?? auth.admin;
  const env = deps.env ?? process.env;
  const sendInvite = deps.sendInvite ?? sendGmailInvite;
  const now = deps.now?.() ?? Date.now();

  const { data, error } = await admin
    .from("client_accounts")
    .select("*")
    .eq("id", parsed.data.client_account_id)
    .maybeSingle();

  if (error || !data) return { ok: false, error: "account_not_found" };

  const account = data as ClientAccountRow;
  const status = account.status as ClientAccountStatus;
  if (status === "activated" || status === "suspended") {
    return { ok: false, error: "account_not_resendable" };
  }

  return deliverInvite(admin, {
    clientAccountId: account.id,
    email: account.email,
    fullName: account.full_name,
    companyName: account.company_name,
    planName: await readPlanNameForAccount(admin, account),
    isResend: true,
    actorUserId: auth.userId,
    env,
    sendInvite,
    now,
  });
}

/**
 * Suspends or reactivates the login.
 *
 * This is an authentication-level ban enforced by Supabase Auth (not a
 * subscription change): the financial state, the invoices and the renewal
 * logic are untouched, and access is restored exactly as before on reactivation.
 */
export async function setAdminClientAccountSuspendedAction(
  raw: unknown,
  deps: ClientAccountActionDeps = {}
): Promise<ClientAccountActionResult> {
  const parsed = setAdminClientAccountSuspendedSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "validation_failed" };

  const auth = await requirePlatformAdmin();
  if (!auth.ok) return auth;

  const admin = deps.admin ?? auth.admin;
  const now = deps.now?.() ?? Date.now();

  const { data, error } = await admin
    .from("client_accounts")
    .select("*")
    .eq("id", parsed.data.client_account_id)
    .maybeSingle();

  if (error || !data) return { ok: false, error: "account_not_found" };

  const account = data as ClientAccountRow;
  const status = account.status as ClientAccountStatus;
  if (parsed.data.suspended && status === "suspended") {
    return { ok: false, error: "suspension_not_supported" };
  }
  if (!parsed.data.suspended && status !== "suspended") {
    return { ok: false, error: "suspension_not_supported" };
  }
  if (!account.user_id) return { ok: false, error: "account_not_found" };

  // `none` un-bans; a fixed long duration bans without an expiry schedule.
  const banDuration = parsed.data.suspended ? "876000h" : "none";
  const { error: banError } = await admin.auth.admin.updateUserById(account.user_id, {
    ban_duration: banDuration,
  });
  if (banError) {
    logger.warn("client_account_ban_failed", { error_code: banError.name ?? "unknown" });
    return { ok: false, error: "unavailable" };
  }

  const nextStatus: ClientAccountStatus = parsed.data.suspended ? "suspended" : "invite_sent";
  const { error: updateError } = await admin
    .from("client_accounts")
    .update({
      status: nextStatus,
      suspended_at: parsed.data.suspended ? new Date(now).toISOString() : null,
      last_error: "",
    })
    .eq("id", account.id);

  if (updateError) return { ok: false, error: "unavailable" };

  await recordEvent(admin, {
    clientAccountId: account.id,
    eventType: parsed.data.suspended ? "account_suspended" : "account_reactivated",
    actorUserId: auth.userId,
  });
  logger.info("client_account_access_changed", {
    client_account_id: account.id,
    suspended: parsed.data.suspended,
  });

  return { ok: true, clientAccountId: account.id, status: nextStatus, inviteSent: false };
}

export type ClientActivationEligibility =
  | { ok: true; status: ClientAccountStatus }
  | {
      ok: false;
      error: "forbidden" | "account_not_found" | "service_role_unavailable" | "unavailable";
    };

/**
 * Resolves whether the current browser session belongs to a client account.
 *
 * An administrator session has no `client_accounts` row and must fail closed
 * here, so `/ativar-conta` never offers that session a password change.
 */
export async function getClientActivationEligibility(
  deps: ClientAccountActionDeps = {}
): Promise<ClientActivationEligibility> {
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) return { ok: false, error: "forbidden" };

    const admin = deps.admin ?? createAdminClient();
    if (!admin) return { ok: false, error: "service_role_unavailable" };

    const { data, error } = await admin
      .from("client_accounts")
      .select("status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error || !data) return { ok: false, error: "account_not_found" };
    const status = (data as { status: unknown }).status;
    if (!isClientAccountStatus(status)) return { ok: false, error: "unavailable" };
    return { ok: true, status };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/**
 * Marks an account as activated once the client successfully sets their own
 * password through the Supabase recovery session.
 *
 * The caller is the invited client (not an admin), so authorization is the
 * freshly established session: the row is matched by the session user id and
 * nothing else. It never elevates roles and never touches subscription state.
 */
export async function markClientAccountActivatedAction(
  deps: ClientAccountActionDeps = {}
): Promise<{ ok: true; clientAccountId: string } | { ok: false; error: ClientAccountError }> {
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id || !user.email) return { ok: false, error: "forbidden" };

    const admin = deps.admin ?? createAdminClient();
    if (!admin) return { ok: false, error: "service_role_unavailable" };

    const { data, error } = await admin
      .from("client_accounts")
      .select("id, status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error || !data) return { ok: false, error: "account_not_found" };
    const account = data as { id: string; status: string };
    const now = deps.now?.() ?? Date.now();

    if (account.status !== "activated") {
      await admin
        .from("client_accounts")
        .update({ status: "activated", activated_at: new Date(now).toISOString(), last_error: "" })
        .eq("id", account.id);
      await recordEvent(admin, {
        clientAccountId: account.id,
        eventType: "account_activated",
        actorUserId: user.id,
      });
      logger.info("client_account_activated", { client_account_id: account.id });
    }

    return { ok: true, clientAccountId: account.id };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export type DefineActivationPasswordDeps = ClientAccountActionDeps & {
  user?: { id: string; email?: string | null } | null;
  freshAccessLink?: boolean;
  updatePassword?: (userId: string, password: string) => Promise<{ errorMessage: string | null }>;
};

/**
 * Sets the invited client's password with the service role.
 * The browser client cannot see the HttpOnly recovery session, so
 * `auth.updateUser` in the page fails with a missing session.
 */
export async function defineClientActivationPassword(
  password: string,
  deps: DefineActivationPasswordDeps = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isPasswordAcceptable(password)) {
    return { ok: false, error: "A senha não atende aos requisitos mínimos." };
  }

  try {
    let user = deps.user;
    if (user === undefined) {
      const { createClient } = await import("@/lib/supabase/server");
      const supabase = await createClient();
      const {
        data: { user: sessionUser },
      } = await supabase.auth.getUser();
      user = sessionUser;
    }
    if (!user?.id) {
      return {
        ok: false,
        error: "Este link expirou ou já foi utilizado. Solicite um novo envio ao suporte ou use a recuperação de senha em /login.",
      };
    }

    const admin = deps.admin ?? createAdminClient();
    if (!admin) return { ok: false, error: "Não foi possível definir a senha. Tente novamente." };

    const { data, error } = await admin
      .from("client_accounts")
      .select("id, status")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error || !data) {
      return {
        ok: false,
        error: "Este link expirou ou já foi utilizado. Solicite um novo envio ao suporte ou use a recuperação de senha em /login.",
      };
    }
    const account = data as { id: string; status: string };
    if (!isClientAccountStatus(account.status) || !canDefineActivationPassword(account.status, deps.freshAccessLink === true)) {
      return {
        ok: false,
        error: "Este link expirou ou já foi utilizado. Solicite um novo envio ao suporte ou use a recuperação de senha em /login.",
      };
    }

    const providerMessage = deps.updatePassword
      ? (await deps.updatePassword(user.id, password)).errorMessage
      : (await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true })).error
          ?.message ?? null;
    if (providerMessage) {
      return { ok: false, error: describeActivationPasswordError(providerMessage) };
    }

    const now = deps.now?.() ?? Date.now();
    if (account.status !== "activated") {
      await admin
        .from("client_accounts")
        .update({ status: "activated", activated_at: new Date(now).toISOString(), last_error: "" })
        .eq("id", account.id);
      await recordEvent(admin, {
        clientAccountId: account.id,
        eventType: "account_activated",
        actorUserId: user.id,
      });
    }
    logger.info("client_account_password_defined", { client_account_id: account.id });
    return { ok: true };
  } catch {
    return { ok: false, error: "Não foi possível definir a senha. Tente novamente." };
  }
}

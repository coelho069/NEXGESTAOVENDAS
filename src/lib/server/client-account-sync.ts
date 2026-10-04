/**
 * Synchronises `client_accounts` after a confirmed purchase onboarding.
 *
 * Service-role only. Failures are logged and surfaced to the caller but must
 * not roll back payment provisioning — the customer already paid.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { createLogger } from "@/lib/observability/logger";
import { normalizeAccountEmail, type ClientAccountStatus } from "@/lib/domain/admin-client-accounts";
import { ACCESS_LINK_TTL_MS } from "@/lib/server/access-link";

const logger = createLogger({ service: "nexgestaovendas", component: "client-account-sync" });

type ClientAccountRow = Database["public"]["Tables"]["client_accounts"]["Row"];

export type SyncClientAccountInput = {
  userId: string;
  email: string;
  fullName: string;
  companyName?: string;
  orgId: string;
  subscriptionId: string | null;
  checkoutClientMutationId?: string | null;
};

export type SyncClientAccountResult =
  | { ok: true; clientAccountId: string; created: boolean; status: ClientAccountStatus }
  | { ok: false; error: string };

async function recordEvent(
  admin: SupabaseClient<Database>,
  input: {
    clientAccountId: string;
    eventType:
      | "account_created"
      | "invite_sent"
      | "invite_resent"
      | "invite_failed"
      | "account_activated";
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

async function readByEmail(
  admin: SupabaseClient<Database>,
  email: string
): Promise<ClientAccountRow | null> {
  const { data, error } = await admin
    .from("client_accounts")
    .select("*")
    .ilike("email", normalizeAccountEmail(email))
    .maybeSingle();
  if (error) return null;
  return data as ClientAccountRow | null;
}

/**
 * Ensures a `client_accounts` row exists for a post-purchase provision.
 * Idempotent on lower(email) and user_id unique indexes.
 */
export async function syncClientAccountAfterPurchase(
  admin: SupabaseClient<Database>,
  input: SyncClientAccountInput
): Promise<SyncClientAccountResult> {
  const email = normalizeAccountEmail(input.email);
  const companyName = (input.companyName ?? "").trim();

  const existing = await readByEmail(admin, email);
  if (existing) {
    const updates: Partial<ClientAccountRow> = {};
    if (input.subscriptionId && existing.subscription_id !== input.subscriptionId) {
      updates.subscription_id = input.subscriptionId;
    }
    if (existing.user_id !== input.userId) {
      updates.user_id = input.userId;
    }
    if (Object.keys(updates).length > 0) {
      await admin.from("client_accounts").update(updates).eq("id", existing.id);
    }
    return {
      ok: true,
      clientAccountId: existing.id,
      created: false,
      status: existing.status as ClientAccountStatus,
    };
  }

  const { data, error } = await admin
    .from("client_accounts")
    .insert({
      user_id: input.userId,
      org_id: input.orgId,
      subscription_id: input.subscriptionId,
      email,
      full_name: input.fullName.trim() || email.split("@")[0] || "Cliente",
      company_name: companyName,
      status: "created",
      created_by: null,
    })
    .select("id, status")
    .single();

  if (error) {
    if (error.code === "23505") {
      const raced = await readByEmail(admin, email);
      if (raced) {
        return {
          ok: true,
          clientAccountId: raced.id,
          created: false,
          status: raced.status as ClientAccountStatus,
        };
      }
    }
    logger.warn("client_account_sync_insert_failed", { error_code: error.code ?? "unknown" });
    return { ok: false, error: "client_account_sync_failed" };
  }

  await recordEvent(admin, {
    clientAccountId: data.id,
    eventType: "account_created",
    actorUserId: null,
  });

  return {
    ok: true,
    clientAccountId: data.id,
    created: true,
    status: (data.status as ClientAccountStatus) ?? "created",
  };
}

export async function markClientAccountAccessEmailSent(
  admin: SupabaseClient<Database>,
  input: { clientAccountId: string; now: number; isResend?: boolean }
): Promise<void> {
  const expiresAt = new Date(input.now + ACCESS_LINK_TTL_MS).toISOString();
  await admin
    .from("client_accounts")
    .update({
      status: "invite_sent",
      invite_sent_at: new Date(input.now).toISOString(),
      invite_expires_at: expiresAt,
      last_error: "",
    })
    .eq("id", input.clientAccountId);

  await recordEvent(admin, {
    clientAccountId: input.clientAccountId,
    eventType: input.isResend ? "invite_resent" : "invite_sent",
    actorUserId: null,
  });
}

export async function markClientAccountAccessEmailFailed(
  admin: SupabaseClient<Database>,
  input: { clientAccountId: string; errorCode: string }
): Promise<void> {
  await admin
    .from("client_accounts")
    .update({ status: "invite_failed", last_error: input.errorCode })
    .eq("id", input.clientAccountId);

  await recordEvent(admin, {
    clientAccountId: input.clientAccountId,
    eventType: "invite_failed",
    actorUserId: null,
    errorCode: input.errorCode,
  });
}

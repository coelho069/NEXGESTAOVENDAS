"use server";

/**
 * Server Action boundary for the client-accounts administration screen.
 *
 * Every exported action re-validates the admin session server-side, rate-limits
 * the invitation path (Gmail quota protection), and revalidates the admin
 * routes. The screen never receives the Supabase service-role client, the
 * activation link, or any Gmail credential.
 */
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ACTIVATION_LINK_COOKIE } from "@/lib/domain/activation-link";
import {
  createAdminClientAccountAction as provisionAccount,
  getClientActivationEligibility,
  defineClientActivationPassword,
  markClientAccountActivatedAction as markClientAccountActivated,
  resendAdminClientAccountInviteAction as resendInvite,
  setAdminClientAccountSuspendedAction as changeSuspension,
  type ClientAccountActionResult,
} from "@/lib/server/admin-client-account-provisioning";
import { getPlatformAdminAccess } from "@/lib/auth/admin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createAdminClientAccountSchema, resendAdminClientAccountInviteSchema } from "@/lib/validation/schemas";

/** Gmail allows ~500 sends/day; the app budget is far below that. */
const INVITE_RATE_LIMIT = 20;
const INVITE_RATE_WINDOW_MS = 60 * 60 * 1000;

function revalidateAdminAccountPaths(): void {
  revalidatePath("/admin/clientes/contas");
  revalidatePath("/admin/assinaturas");
}

async function requireAdminWithQuota(): Promise<
  { ok: true; userId: string } | { ok: false; error: "forbidden" | "rate_limited" }
> {
  const access = await getPlatformAdminAccess();
  if (!access) return { ok: false, error: "forbidden" };

  const quota = consumeRateLimit({
    key: `admin-client-account-invite:${access.userId}`,
    limit: INVITE_RATE_LIMIT,
    windowMs: INVITE_RATE_WINDOW_MS,
  });
  if (!quota.allowed) return { ok: false, error: "rate_limited" };

  return { ok: true, userId: access.userId };
}

export async function createAdminClientAccountAction(
  raw: unknown
): Promise<ClientAccountActionResult> {
  const auth = await requireAdminWithQuota();
  if (!auth.ok) return auth;

  // Parsing happens before provisioning so malformed input never reaches
  // Supabase Auth or Gmail.
  if (!createAdminClientAccountSchema.safeParse(raw).success) {
    return { ok: false, error: "validation_failed" };
  }

  const result = await provisionAccount(raw);
  revalidateAdminAccountPaths();
  return result;
}

export async function resendAdminClientAccountInviteAction(
  raw: unknown
): Promise<ClientAccountActionResult> {
  const auth = await requireAdminWithQuota();
  if (!auth.ok) return auth;

  if (!resendAdminClientAccountInviteSchema.safeParse(raw).success) {
    return { ok: false, error: "validation_failed" };
  }

  const result = await resendInvite(raw);
  revalidateAdminAccountPaths();
  return result;
}

export async function setAdminClientAccountSuspendedAction(
  raw: unknown
): Promise<ClientAccountActionResult> {
  const access = await getPlatformAdminAccess();
  if (!access) return { ok: false, error: "forbidden" };

  const result = await changeSuspension(raw);
  revalidateAdminAccountPaths();
  return result;
}

/**
 * Read-only check used by /ativar-conta before any password update.
 * Returns the client-account status for the current session, or a closed error
 * when that session is an administrator (or anyone without a client account).
 */
export async function getClientActivationEligibilityAction(): Promise<
  Awaited<ReturnType<typeof getClientActivationEligibility>>
> {
  return getClientActivationEligibility();
}

/**
 * Called by the invited client from /ativar-conta right after they set their own
 * password. Authorization is the recovery session established by the Supabase
 * invite link — not an admin session — and the row is resolved by that session's
 * user id, so a client can only ever activate their own account.
 */
export async function markClientAccountActivatedAction(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const result = await markClientAccountActivated();
  revalidatePath("/admin/clientes/contas");
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function defineActivationPasswordAction(
  password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cookieStore = await cookies();
  const freshAccessLink = cookieStore.get(ACTIVATION_LINK_COOKIE)?.value === "1";
  const result = await defineClientActivationPassword(password, { freshAccessLink });
  if (result.ok) revalidatePath("/admin/clientes/contas");
  return result;
}

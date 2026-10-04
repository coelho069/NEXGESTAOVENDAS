/**
 * Supabase Auth access links for post-purchase and admin re-send flows.
 *
 * Never logs or persists the action_link. The link is returned only to the
 * e-mail transport layer.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

/** Mirrors Supabase default invite/recovery link lifetime (24h). */
export const ACCESS_LINK_TTL_MS = 24 * 60 * 60 * 1000;

export type AccessLinkResult =
  | { ok: true; actionLink: string; userId: string; linkType: "invite" | "recovery" }
  | { ok: false; error: string };

async function findAuthUserIdByEmail(
  admin: SupabaseClient<Database>,
  email: string
): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const users = data?.users ?? [];
    const match = users.find((user) => (user.email ?? "").toLowerCase() === normalized);
    if (match?.id) return match.id;
    if (users.length < 200) break;
  }
  return null;
}

/**
 * Issues a single-use link for the client to define their password at
 * `/ativar-conta`. New users are created via `invite`; existing logins receive
 * a `recovery` link without overwriting credentials server-side.
 */
export async function generateAccessLink(
  admin: SupabaseClient<Database>,
  input: { email: string; redirectTo: string; userExists?: boolean }
): Promise<AccessLinkResult> {
  const email = input.email.trim().toLowerCase();
  const existingUserId =
    input.userExists === true
      ? await findAuthUserIdByEmail(admin, email)
      : input.userExists === false
        ? null
        : await findAuthUserIdByEmail(admin, email);

  const linkType = existingUserId ? "recovery" : "invite";
  const { data, error } = await admin.auth.admin.generateLink({
    type: linkType,
    email,
    options: { redirectTo: input.redirectTo },
  });
  if (error || !data?.properties?.action_link) {
    return { ok: false, error: "access_link_generation_failed" };
  }

  const userId = existingUserId ?? (await findAuthUserIdByEmail(admin, email));
  if (!userId) {
    return { ok: false, error: "access_link_user_missing" };
  }

  return {
    ok: true,
    actionLink: data.properties.action_link,
    userId,
    linkType,
  };
}

import type { AuthedContext } from "@/lib/auth/session";
import type { createClient } from "@/lib/supabase/server";

/**
 * Matches RLS on `customers` insert/update: `user_has_org_membership()`
 * plus a resolved `org_id` from the authenticated profile.
 */
export async function resolveCustomerWriteContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  auth: AuthedContext | null
): Promise<{ orgId: string } | null> {
  if (!auth?.orgId) return null;

  const { data: hasMembership, error } = await supabase.rpc("user_has_org_membership");
  if (error || !hasMembership) return null;

  return { orgId: auth.orgId };
}

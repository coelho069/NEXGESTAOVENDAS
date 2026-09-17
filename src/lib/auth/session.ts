import { createClient } from "@/lib/supabase/server";
import type { MemberRole } from "@/lib/domain/rbac";
import { resolveStoreRole } from "@/lib/auth/authorization";

export type AuthedContext = {
  userId: string;
  role: MemberRole | null;
  orgId: string | null;
};

export async function getAuthedContext(storeId?: string): Promise<AuthedContext | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .maybeSingle();

    const role = storeId
      ? await resolveStoreRole(supabase, { userId: user.id, storeId })
      : null;

    return {
      userId: user.id,
      role,
      orgId: profile?.org_id ?? null,
    };
  } catch {
    return null;
  }
}
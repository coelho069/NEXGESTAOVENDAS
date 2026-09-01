import { createClient } from "@/lib/supabase/server";
import type { MemberRole } from "@/lib/domain/rbac";

export type AuthedContext = {
  userId: string;
  role: MemberRole;
  orgId: string | null;
};

export async function getAuthedContext(): Promise<AuthedContext | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile } = await supabase
      .from("profiles")
      .select("default_role, org_id")
      .eq("id", user.id)
      .maybeSingle();

    return {
      userId: user.id,
      role: (profile?.default_role as MemberRole | undefined) ?? "cashier",
      orgId: profile?.org_id ?? null,
    };
  } catch {
    return null;
  }
}
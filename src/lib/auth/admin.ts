import { createClient } from "@/lib/supabase/server";

export type PlatformAdminAccess = {
  userId: string;
  role: "platform_admin";
};

/**
 * Platform ADM access is deliberately separate from store_members.role.
 * Membership roles authorize a tenant; this table authorizes the SaaS platform.
 */
export async function getPlatformAdminAccess(): Promise<PlatformAdminAccess | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (error || !data) return null;
    return { userId: user.id, role: "platform_admin" };
  } catch {
    return null;
  }
}

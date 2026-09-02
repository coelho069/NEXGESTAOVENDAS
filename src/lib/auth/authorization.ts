import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { MemberRole } from "@/lib/domain/rbac";

type AppSupabaseClient = SupabaseClient<Database>;

const MANAGERIAL_ROLES: MemberRole[] = ["admin", "manager"];

export async function resolveStoreRole(
  supabase: AppSupabaseClient,
  input: { userId: string; orgId: string | null; storeId: string }
): Promise<MemberRole | null> {
  if (!input.orgId) return null;

  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("org_id, is_active")
    .eq("id", input.storeId)
    .maybeSingle();
  if (storeError || !store || !store.is_active || store.org_id !== input.orgId) {
    return null;
  }

  const { data: member, error: memberError } = await supabase
    .from("store_members")
    .select("role")
    .eq("org_id", input.orgId)
    .eq("store_id", input.storeId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (memberError || !member) return null;
  return member.role as MemberRole;
}

export async function resolveOrganizationRole(
  supabase: AppSupabaseClient,
  input: { userId: string; orgId: string | null }
): Promise<MemberRole | null> {
  if (!input.orgId) return null;

  const { data, error } = await supabase
    .from("store_members")
    .select("role")
    .eq("org_id", input.orgId)
    .eq("user_id", input.userId)
    .in("role", MANAGERIAL_ROLES)
    .limit(10);

  if (error || !data?.length) return null;
  return data.some((member) => member.role === "admin") ? "admin" : "manager";
}

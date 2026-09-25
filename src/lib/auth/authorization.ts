import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { MemberRole } from "@/lib/domain/rbac";

type AppSupabaseClient = SupabaseClient<Database>;

function isMemberRole(value: unknown): value is MemberRole {
  return value === "admin" || value === "manager" || value === "cashier";
}

export async function resolveStoreRole(
  supabase: AppSupabaseClient,
  input: { userId: string; storeId: string }
): Promise<MemberRole | null> {
  if (!input.userId || !input.storeId) return null;

  const { data, error } = await supabase.rpc("user_store_role", {
    p_store_id: input.storeId,
  });
  if (error || !isMemberRole(data)) return null;
  return data;
}

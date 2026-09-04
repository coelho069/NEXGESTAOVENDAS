import { createClient } from "@/lib/supabase/server";
import type { MemberRole } from "@/lib/domain/rbac";
import { storeIdSchema } from "@/lib/validation/schemas";
import {
  buildAuthorizedStores,
  selectAuthorizedStore,
  type AuthorizedStore,
  type MembershipContextRow,
  type StoreContextRow,
} from "@/lib/auth/store-context";
import type { Tables } from "@/lib/db/types";

export type AuthedContext = {
  userId: string;
  role: MemberRole | null;
  orgId: string | null;
  storeId: string | null;
  storeName: string | null;
  stores: AuthorizedStore[];
};

type MembershipRow = Pick<Tables<"store_members">, "store_id" | "org_id" | "role">;
type StoreRow = Pick<Tables<"stores">, "id" | "org_id" | "name" | "is_active">;

async function loadAuthorizedStores(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  orgId: string | null
): Promise<AuthorizedStore[]> {
  if (!orgId) return [];

  const { data: membershipData, error: membershipError } = await supabase
    .from("store_members")
    .select("store_id, org_id, role")
    .eq("user_id", userId)
    .eq("org_id", orgId);

  if (membershipError) throw membershipError;

  const memberships = (membershipData ?? []) as MembershipRow[];
  const storeIds = [...new Set(memberships.map((membership) => membership.store_id))];
  if (storeIds.length === 0) return [];

  const { data: storeData, error: storeError } = await supabase
    .from("stores")
    .select("id, org_id, name, is_active")
    .in("id", storeIds)
    .eq("org_id", orgId)
    .eq("is_active", true);

  if (storeError) throw storeError;

  return buildAuthorizedStores(
    memberships as MembershipContextRow[],
    ((storeData ?? []) as StoreRow[]) as StoreContextRow[],
    orgId
  );
}

export async function getAuthedContext(storeId?: string): Promise<AuthedContext | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    const orgId = profile?.org_id ?? null;
    const stores = await loadAuthorizedStores(supabase, user.id, orgId);
    const requestedStoreIsValid =
      storeId === undefined || storeIdSchema.safeParse(storeId).success;
    const selectedStore = requestedStoreIsValid
      ? selectAuthorizedStore(stores, storeId)
      : null;

    return {
      userId: user.id,
      role: selectedStore?.role ?? null,
      orgId,
      storeId: selectedStore?.id ?? null,
      storeName: selectedStore?.name ?? null,
      stores,
    };
  } catch {
    return null;
  }
}
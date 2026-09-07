import type { MemberRole } from "@/lib/domain/rbac";

export type StoreOption = {
  id: string;
  name: string;
};

export type AuthorizedStore = StoreOption & {
  orgId: string;
  role: MemberRole;
};

export type MembershipContextRow = {
  store_id: string;
  org_id: string;
  role: MemberRole;
};

export type StoreContextRow = {
  id: string;
  org_id: string;
  name: string;
  is_active: boolean;
};

function isMemberRole(value: unknown): value is MemberRole {
  return value === "admin" || value === "manager" || value === "cashier";
}

export function buildAuthorizedStores(
  memberships: readonly MembershipContextRow[],
  stores: readonly StoreContextRow[],
  orgId: string | null
): AuthorizedStore[] {
  if (!orgId) return [];

  const rolesByStore = new Map<string, MemberRole>();
  for (const membership of memberships) {
    if (membership.org_id !== orgId || !isMemberRole(membership.role)) continue;
    rolesByStore.set(membership.store_id, membership.role);
  }

  return stores
    .filter((store) => store.org_id === orgId && store.is_active && rolesByStore.has(store.id))
    .map((store) => ({
      id: store.id,
      name: store.name,
      orgId,
      role: rolesByStore.get(store.id)!,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function selectAuthorizedStore(
  stores: readonly AuthorizedStore[],
  requestedStoreId?: string
): AuthorizedStore | null {
  if (requestedStoreId !== undefined) {
    return stores.find((store) => store.id === requestedStoreId) ?? null;
  }

  return stores.length === 1 ? stores[0] ?? null : null;
}

export function soleAuthorizedStoreId(stores: readonly { id: string }[]): string | null {
  return stores.length === 1 ? stores[0]?.id ?? null : null;
}

export function shouldShowStoreSelect(stores: readonly { id: string }[]): boolean {
  return stores.length > 1;
}

export function toStoreOptions(stores: readonly AuthorizedStore[]): StoreOption[] {
  return stores.map(({ id, name }) => ({ id, name }));
}

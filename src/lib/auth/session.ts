import * as React from "react";
import type { User } from "@supabase/supabase-js";
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

/**
 * React.cache deduplica chamadas dentro do mesmo request no runtime do App Router.
 * Os tipos de @types/react 18.3 não declaram `cache`, então a leitura é feita com
 * fallback para função identidade (sem deduplicação) quando ausente.
 */
const requestCache: <F extends (...args: never[]) => unknown>(fn: F) => F =
  (React as unknown as { cache?: <F extends (...args: never[]) => unknown>(fn: F) => F })
    .cache ?? ((fn) => fn);

type MembershipWithStoreRow = MembershipRow & {
  stores: StoreRow | StoreRow[] | null;
};

/**
 * Uma única ida ao banco para vínculos + lojas (embed por FK `store_members_store_id_fkey`).
 * O filtro por org e por loja ativa continua em `buildAuthorizedStores`.
 */
async function loadMembershipsWithStores(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<{ memberships: MembershipContextRow[]; stores: StoreContextRow[] }> {
  const { data, error } = await supabase
    .from("store_members")
    .select(
      "store_id, org_id, role, stores:stores!store_members_store_id_fkey(id, org_id, name, is_active)"
    )
    .eq("user_id", userId);

  if (error) throw error;

  const rows = (data ?? []) as unknown as MembershipWithStoreRow[];
  const storesById = new Map<string, StoreContextRow>();
  for (const row of rows) {
    const embedded = Array.isArray(row.stores) ? row.stores : row.stores ? [row.stores] : [];
    for (const store of embedded) {
      if (!storesById.has(store.id)) storesById.set(store.id, store as StoreContextRow);
    }
  }

  return {
    memberships: rows.map(({ store_id, org_id, role }) => ({ store_id, org_id, role })),
    stores: [...storesById.values()],
  };
}

/** Usuário da sessão. Cada chamada vai ao Auth; `React.cache` evita repetir no mesmo request. */
export const getSessionUser = requestCache(async function getSessionUser(): Promise<User | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch {
    return null;
  }
});

/** `knownUser` evita um segundo getUser quando a página já leu a sessão. */
export async function getAuthedContext(
  storeId?: string,
  knownUser?: User | null
): Promise<AuthedContext | null> {
  try {
    const user = knownUser !== undefined ? knownUser : await getSessionUser();
    if (!user) return null;
    const supabase = await createClient();

    // Perfil (org) e vínculos+lojas são independentes: rodam em paralelo.
    const [profileResult, membershipResult] = await Promise.all([
      supabase.from("profiles").select("org_id").eq("id", user.id).maybeSingle(),
      loadMembershipsWithStores(supabase, user.id),
    ]);
    if (profileResult.error) throw profileResult.error;

    const orgId = profileResult.data?.org_id ?? null;
    const stores = buildAuthorizedStores(
      membershipResult.memberships,
      membershipResult.stores,
      orgId
    );
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

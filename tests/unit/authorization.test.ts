import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { resolveOrganizationRole, resolveStoreRole } from "@/lib/auth/authorization";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_ID = "11111111-1111-4111-8111-111111111111";
const STORE_A = "22222222-2222-4222-8222-222222222201";
const STORE_B = "22222222-2222-4222-8222-222222222202";

type StoreState = {
  orgId: string;
  isActive: boolean;
  role?: Database["public"]["Enums"]["member_role"];
};

function createSupabaseMock(stores: Record<string, StoreState>) {
  const queries: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      queries.push({ table, filters });
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        in: () => chain,
        limit: () => chain,
        then: (resolve: (value: unknown) => unknown) => {
          const matchingStores = Object.values(stores).filter((store) => store.orgId === filters.org_id && store.isActive);
          return Promise.resolve({
            data: matchingStores.filter((store) => store.role === "admin" || store.role === "manager").map((store) => ({ role: store.role })),
            error: null,
          }).then(resolve);
        },
        maybeSingle: async () => {
          if (table === "stores") {
            const store = stores[String(filters.id)];
            return {
              data: store ? { org_id: store.orgId, is_active: store.isActive } : null,
              error: null,
            };
          }
          const store = stores[String(filters.store_id)];
          return {
            data: store?.role ? { role: store.role } : null,
            error: null,
          };
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
  return { client, queries };
}

describe("store membership authorization", () => {
  it("uses the store membership role when profile metadata disagrees", async () => {
    const { client, queries } = createSupabaseMock({
      [STORE_A]: { orgId: ORG_ID, isActive: true, role: "cashier" },
    });

    await expect(resolveStoreRole(client, { userId: USER_ID, storeId: STORE_A })).resolves.toBe("cashier");
    expect(queries.map((query) => query.table)).toEqual(["stores", "store_members"]);
    expect(queries[1]?.filters).toMatchObject({
      org_id: ORG_ID,
      store_id: STORE_A,
      user_id: USER_ID,
    });
  });

  it("denies an active store without membership", async () => {
    const { client } = createSupabaseMock({
      [STORE_A]: { orgId: ORG_ID, isActive: true },
    });

    await expect(resolveStoreRole(client, { userId: USER_ID, storeId: STORE_A })).resolves.toBeNull();
  });

  it("resolves roles independently for each store and observes changes without a stale cache", async () => {
    const stores: Record<string, StoreState> = {
      [STORE_A]: { orgId: ORG_ID, isActive: true, role: "manager" },
      [STORE_B]: { orgId: ORG_ID, isActive: true, role: "cashier" },
    };
    const { client } = createSupabaseMock(stores);

    await expect(resolveStoreRole(client, { userId: USER_ID, storeId: STORE_A })).resolves.toBe("manager");
    await expect(resolveStoreRole(client, { userId: USER_ID, storeId: STORE_B })).resolves.toBe("cashier");

    stores[STORE_A].role = "cashier";
    await expect(resolveStoreRole(client, { userId: USER_ID, storeId: STORE_A })).resolves.toBe("cashier");
  });

  it("derives organization management access from memberships, not profile defaults", async () => {
    const { client } = createSupabaseMock({
      [STORE_A]: { orgId: ORG_ID, isActive: true, role: "manager" },
    });

    await expect(resolveOrganizationRole(client, { userId: USER_ID, orgId: ORG_ID })).resolves.toBe("manager");
  });
});

describe("RBAC migration guard", () => {
  it("does not retain a default_role authorization fallback", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260902201000_rbac_store_membership_authority.sql"),
      "utf8"
    );

    expect(migration).toContain("public.store_members");
    expect(migration).toContain("public.user_store_role(p_store_id)");
    expect(migration).not.toMatch(/SELECT\s+default_role\s+FROM\s+public\.profiles/i);
    expect(migration).not.toMatch(/p\.default_role/i);
  });
});

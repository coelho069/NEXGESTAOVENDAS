import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { resolveStoreRole } from "@/lib/auth/authorization";

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
  const client = {
    rpc: async (name: string, args: { p_store_id: string }) => {
      if (name !== "user_store_role") {
        return { data: null, error: new Error("unexpected rpc") };
      }
      const store = stores[args.p_store_id];
      return {
        data: store?.isActive ? (store.role ?? null) : null,
        error: null,
      };
    },
  } as unknown as SupabaseClient<Database>;
  return { client };
}

describe("store membership authorization", () => {
  it("uses the store membership role when profile metadata disagrees", async () => {
    const { client } = createSupabaseMock({
      [STORE_A]: { orgId: ORG_ID, isActive: true, role: "cashier" },
    });

    await expect(resolveStoreRole(client, { userId: USER_ID, storeId: STORE_A })).resolves.toBe("cashier");
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

  it("does not resolve a role for an inactive store", async () => {
    const { client } = createSupabaseMock({
      [STORE_A]: { orgId: ORG_ID, isActive: false, role: "manager" },
    });

    await expect(resolveStoreRole(client, { userId: USER_ID, storeId: STORE_A })).resolves.toBeNull();
  });
});

describe("RBAC migration guard", () => {
  it("does not retain a default_role authorization fallback", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260902225832_catalog_store_scope.sql"),
      "utf8"
    );
    const session = readFileSync(resolve(process.cwd(), "src/lib/auth/session.ts"), "utf8");

    expect(migration).toContain("public.store_members");
    expect(migration).toContain("public.user_has_org_role(");
    expect(migration).toContain("p_store_id uuid");
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE ON public.products FROM authenticated");
    expect(migration).not.toMatch(/SELECT\s+default_role\s+FROM\s+public\.profiles/i);
    expect(migration).not.toMatch(/p\.default_role/i);
    expect(session).not.toContain("default_role");
  });
});

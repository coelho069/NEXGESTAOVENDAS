import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient }));

import { getAuthedContext } from "@/lib/auth/session";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_A = "11111111-1111-4111-8111-111111111111";
const STORE_A = "22222222-2222-4222-8222-222222222201";
const STORE_B = "22222222-2222-4222-8222-222222222202";

function queryResult<T>(result: { data: T; error: null }) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

function mockSupabase(
  memberships: Array<{ store_id: string; org_id: string; role: "admin" | "manager" | "cashier" }>,
  stores: Array<{ id: string; org_id: string; name: string; is_active: boolean }>
) {
  createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
    from: vi.fn((table: string) => {
      if (table === "profiles") return queryResult({ data: { org_id: ORG_A }, error: null });
      if (table === "store_members") return queryResult({ data: memberships, error: null });
      if (table === "stores") return queryResult({ data: stores, error: null });
      throw new Error(`unexpected table ${table}`);
    }),
  });
}

describe("authenticated store context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives roles from memberships and removes inactive/cross-organization stores", async () => {
    mockSupabase(
      [
        { store_id: STORE_A, org_id: ORG_A, role: "manager" },
        { store_id: STORE_B, org_id: ORG_A, role: "cashier" },
      ],
      [
        { id: STORE_A, org_id: ORG_A, name: "Centro", is_active: true },
        { id: STORE_B, org_id: ORG_A, name: "Shopping", is_active: false },
        { id: "99999999-9999-4999-8999-999999999999", org_id: "99999999-9999-4999-8999-999999999998", name: "Other", is_active: true },
      ]
    );

    const context = await getAuthedContext(STORE_A);

    expect(context).toMatchObject({
      userId: USER_ID,
      orgId: ORG_A,
      storeId: STORE_A,
      role: "manager",
    });
    expect(context?.stores).toEqual([
      { id: STORE_A, name: "Centro", orgId: ORG_A, role: "manager" },
    ]);
  });

  it("does not select an arbitrary store when the URL is absent or invalid", async () => {
    mockSupabase(
      [{ store_id: STORE_A, org_id: ORG_A, role: "manager" }],
      [{ id: STORE_A, org_id: ORG_A, name: "Centro", is_active: true }]
    );

    await expect(getAuthedContext("not-a-uuid")).resolves.toMatchObject({
      orgId: ORG_A,
      storeId: null,
      role: null,
    });
    await expect(getAuthedContext()).resolves.toMatchObject({
      orgId: ORG_A,
      storeId: STORE_A,
      role: "manager",
    });
  });

  it("returns no authorized store for a user without memberships", async () => {
    mockSupabase([], [{ id: STORE_A, org_id: ORG_A, name: "Centro", is_active: true }]);

    await expect(getAuthedContext(STORE_A)).resolves.toMatchObject({
      orgId: ORG_A,
      storeId: null,
      role: null,
      stores: [],
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPlatformAdminAccess, createClient } = vi.hoisted(() => ({
  getPlatformAdminAccess: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth/admin", () => ({ getPlatformAdminAccess }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

import {
  loadAdminSubscriptionDetail,
  loadAdminSubscriptions,
  loadCurrentAdminPlans,
} from "@/lib/server/admin-subscriptions-query";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const PLAN_ID = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function rangeResult<T>(rows: T[]) {
  return {
    order: () => ({
      range: async () => ({ data: rows, error: null }),
    }),
  };
}

describe("admin subscriptions query isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks plan/subscription reads for non platform admins", async () => {
    getPlatformAdminAccess.mockResolvedValue(null);
    await expect(loadCurrentAdminPlans()).resolves.toEqual({
      data: null,
      error: "forbidden_admin",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("lists organizations with their own subscription and keeps org isolation in detail", async () => {
    getPlatformAdminAccess.mockResolvedValue({
      userId: ADMIN_ID,
      role: "platform_admin",
    });

    createClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table === "organizations") {
          return {
            select: () =>
              rangeResult([
                {
                  id: ORG_A,
                  name: "Org A",
                  slug: "org-a",
                  currency: "BRL",
                  timezone: "America/Sao_Paulo",
                  updated_at: "2026-09-01T00:00:00.000Z",
                },
                {
                  id: ORG_B,
                  name: "Org B",
                  slug: "org-b",
                  currency: "BRL",
                  timezone: "America/Sao_Paulo",
                  updated_at: "2026-09-01T00:00:00.000Z",
                },
              ]),
          };
        }
        if (table === "stores") {
          return {
            select: () =>
              rangeResult([
                {
                  id: "store-a",
                  org_id: ORG_A,
                  name: "Loja A",
                  code: "A1",
                  is_active: true,
                  created_at: "2026-09-01T00:00:00.000Z",
                  updated_at: "2026-09-01T00:00:00.000Z",
                },
              ]),
          };
        }
        if (table === "profiles") {
          return { select: () => rangeResult([]) };
        }
        if (table === "store_members") {
          return { select: () => rangeResult([]) };
        }
        if (table === "plans") {
          return {
            select: () =>
              rangeResult([
                {
                  id: PLAN_ID,
                  name: "Pro",
                  description: "Plano Pro",
                  amount: 99.9,
                  currency: "BRL",
                  billing_interval: "monthly",
                  is_active: true,
                  created_at: "2026-09-01T00:00:00.000Z",
                  updated_at: "2026-09-01T00:00:00.000Z",
                },
              ]),
          };
        }
        if (table === "subscriptions") {
          return {
            select: () =>
              rangeResult([
                {
                  id: "sub-a",
                  org_id: ORG_A,
                  plan_id: PLAN_ID,
                  status: "active",
                  contracted_amount: 99.9,
                  currency: "BRL",
                  period_start: "2026-09-01",
                  period_end: "2026-10-01",
                  cancelled_at: null,
                  created_at: "2026-09-01T00:00:00.000Z",
                  updated_at: "2026-09-01T00:00:00.000Z",
                },
              ]),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    });

    const list = await loadAdminSubscriptions(
      { userId: ADMIN_ID, role: "platform_admin" },
      {}
    );
    expect(list.error).toBeNull();
    expect(list.data?.records).toHaveLength(2);
    expect(list.data?.records.find((row) => row.id === ORG_A)?.status).toBe("active");
    expect(list.data?.records.find((row) => row.id === ORG_B)?.status).toBe("none");
    expect(list.data?.plans).toHaveLength(1);

    const detailA = await loadAdminSubscriptionDetail(
      { userId: ADMIN_ID, role: "platform_admin" },
      ORG_A
    );
    expect(detailA.data?.id).toBe(ORG_A);
    expect(detailA.data?.subscriptionId).toBe("sub-a");
    expect(detailA.data?.stores.map((store) => store.id)).toEqual(["store-a"]);

    const detailB = await loadAdminSubscriptionDetail(
      { userId: ADMIN_ID, role: "platform_admin" },
      ORG_B
    );
    expect(detailB.data?.id).toBe(ORG_B);
    expect(detailB.data?.subscriptionId).toBeNull();
    expect(detailB.data?.stores).toEqual([]);
  });
});

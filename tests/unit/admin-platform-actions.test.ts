import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPlatformAdminAccess, createClient, revalidatePath } = vi.hoisted(() => ({
  getPlatformAdminAccess: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/admin", () => ({ getPlatformAdminAccess }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  cancelAdminSubscriptionAction,
  createAdminPlanAction,
  createAdminSubscriptionAction,
  deleteAdminPlanAction,
  setAdminPlanActiveAction,
  updateAdminSubscriptionPeriodAction,
  updateAdminSubscriptionPlanAction,
  updateAdminSubscriptionStatusAction,
} from "@/lib/server/admin-platform-actions";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const SUB_ID = "33333333-3333-4333-8333-333333333333";

describe("admin platform actions authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPlatformAdminAccess.mockResolvedValue(null);
  });

  it("rejects every write action when caller is not platform admin", async () => {
    const payloads = [
      createAdminSubscriptionAction({
        org_id: ORG_ID,
        plan_id: PLAN_ID,
        period_start: "2026-09-01",
        period_end: "2026-10-01",
        status: "active",
      }),
      updateAdminSubscriptionPlanAction({
        subscription_id: SUB_ID,
        plan_id: PLAN_ID,
      }),
      updateAdminSubscriptionStatusAction({
        subscription_id: SUB_ID,
        status: "active",
      }),
      updateAdminSubscriptionPeriodAction({
        subscription_id: SUB_ID,
        period_start: "2026-09-01",
        period_end: "2026-10-01",
      }),
      cancelAdminSubscriptionAction({ subscription_id: SUB_ID }),
      createAdminPlanAction({
        name: "Pro",
        amount: "99.90",
        billing_interval: "monthly",
      }),
      setAdminPlanActiveAction({ plan_id: PLAN_ID, is_active: false }),
      deleteAdminPlanAction({ plan_id: PLAN_ID }),
    ];

    const results = await Promise.all(payloads);
    for (const result of results) {
      expect(result).toEqual({ ok: false, error: "forbidden" });
    }
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects invalid payloads even for platform admin", async () => {
    getPlatformAdminAccess.mockResolvedValue({
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      role: "platform_admin",
    });

    await expect(
      createAdminSubscriptionAction({
        org_id: "not-a-uuid",
        plan_id: PLAN_ID,
        period_start: "2026-09-01",
        period_end: "2026-10-01",
        status: "active",
      })
    ).resolves.toEqual({ ok: false, error: "validation_failed" });

    await expect(
      updateAdminSubscriptionStatusAction({
        subscription_id: SUB_ID,
        status: "cancelled",
      })
    ).resolves.toEqual({ ok: false, error: "validation_failed" });

    expect(createClient).not.toHaveBeenCalled();
  });

  it("blocks deleting a plan that still has subscriptions", async () => {
    getPlatformAdminAccess.mockResolvedValue({
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      role: "platform_admin",
    });

    createClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table === "subscriptions") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(async () => ({ count: 2, error: null })),
            })),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    });

    await expect(deleteAdminPlanAction({ plan_id: PLAN_ID })).resolves.toEqual({
      ok: false,
      error: "plan_in_use",
    });
  });

  it("creates a subscription for platform admin using org_id and plan amount", async () => {
    getPlatformAdminAccess.mockResolvedValue({
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      role: "platform_admin",
    });

    const insert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({ data: { id: SUB_ID }, error: null })),
      })),
    }));

    createClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table === "plans") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    id: PLAN_ID,
                    amount: 99.9,
                    currency: "BRL",
                    is_active: true,
                  },
                  error: null,
                })),
              })),
            })),
          };
        }
        if (table === "organizations") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { id: ORG_ID },
                  error: null,
                })),
              })),
            })),
          };
        }
        if (table === "subscriptions") {
          return { insert };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    });

    await expect(
      createAdminSubscriptionAction({
        org_id: ORG_ID,
        plan_id: PLAN_ID,
        period_start: "2026-09-01",
        period_end: "2026-10-01",
        status: "active",
      })
    ).resolves.toEqual({ ok: true, id: SUB_ID });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: ORG_ID,
        plan_id: PLAN_ID,
        status: "active",
        contracted_amount: 99.9,
        cancelled_at: null,
      })
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin/assinaturas");
  });

  it("cancels a subscription with UPDATE status+cancelled_at and never DELETE", async () => {
    getPlatformAdminAccess.mockResolvedValue({
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      role: "platform_admin",
    });

    const update = vi.fn(() => ({
      eq: vi.fn(async () => ({ error: null })),
    }));
    const deleteFn = vi.fn();

    createClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table === "subscriptions") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    id: SUB_ID,
                    org_id: ORG_ID,
                    status: "active",
                  },
                  error: null,
                })),
              })),
            })),
            update,
            delete: deleteFn,
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    });

    await expect(
      cancelAdminSubscriptionAction({ subscription_id: SUB_ID })
    ).resolves.toEqual({ ok: true, id: SUB_ID });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "canceled",
        cancelled_at: expect.any(String),
      })
    );
    expect(deleteFn).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/assinaturas/${ORG_ID}`);
  });

  it("creates a plan with server-side validation for platform admin", async () => {
    getPlatformAdminAccess.mockResolvedValue({
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      role: "platform_admin",
    });

    const insert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({ data: { id: PLAN_ID }, error: null })),
      })),
    }));

    createClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table === "plans") return { insert };
        throw new Error(`unexpected table ${table}`);
      }),
    });

    await expect(
      createAdminPlanAction({
        name: "Pro",
        description: "Plano profissional",
        amount: "99.90",
        billing_interval: "monthly",
        is_active: true,
      })
    ).resolves.toEqual({ ok: true, id: PLAN_ID });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Pro",
        amount: 99.9,
        billing_interval: "monthly",
        is_active: true,
      })
    );
  });
});

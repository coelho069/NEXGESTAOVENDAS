import { describe, expect, it } from "vitest";
import {
  buildAdminSubscriptionOverview,
  compareSubscriptionExpiration,
  describeSubscriptionAccessForAdmin,
  filterAdminSubscriptionRecords,
  findNextSubscriptionExpirations,
  pickCurrentSubscription,
  type AdminSubscriptionRecord,
} from "@/lib/domain/admin-subscriptions";
import {
  adminSubscriptionListQuerySchema,
  cancelAdminSubscriptionSchema,
  createAdminPlanSchema,
  createAdminSubscriptionSchema,
  deleteAdminPlanSchema,
  updateAdminPlanSchema,
  updateAdminSubscriptionStatusSchema,
} from "@/lib/validation/schemas";

function record(
  overrides: Partial<AdminSubscriptionRecord> & Pick<AdminSubscriptionRecord, "id" | "clientName">
): AdminSubscriptionRecord {
  return {
    subscriptionId: null,
    clientSlug: overrides.clientSlug ?? overrides.clientName.toLowerCase(),
    planId: null,
    planName: null,
    status: "none",
    billingInterval: null,
    startedAt: null,
    expiresAt: null,
    amount: null,
    cancelledAt: null,
    subscriptionCreatedAt: null,
    subscriptionUpdatedAt: null,
    pdvStatus: "active",
    accessAllowed: false,
    accessReason: "none",
    accessMessage: "Organização sem assinatura cadastrada.",
    lastUpdated: "2026-09-01T00:00:00.000Z",
    currency: "BRL",
    timezone: "America/Sao_Paulo",
    storeCount: 1,
    activeStoreCount: 1,
    teamMemberCount: 1,
    sourceEntity: "organizations",
    ...overrides,
  };
}

describe("admin subscription filters and overview", () => {
  const records = [
    record({
      id: "org-1",
      clientName: "Alpha Mercado",
      clientSlug: "alpha",
      status: "active",
      planId: "plan-pro",
      planName: "Pro",
      billingInterval: "monthly",
      amount: "100.00",
      expiresAt: "2026-10-01",
      sourceEntity: "subscriptions",
      subscriptionId: "sub-1",
      accessAllowed: true,
      accessReason: "ok",
    }),
    record({
      id: "org-2",
      clientName: "Beta Loja",
      clientSlug: "beta",
      status: "expired",
      planId: "plan-basic",
      planName: "Basic",
      billingInterval: "yearly",
      amount: "1200.00",
      expiresAt: "2026-08-01",
      sourceEntity: "subscriptions",
      subscriptionId: "sub-2",
    }),
    record({
      id: "org-3",
      clientName: "Charlie Sem Assinatura",
      clientSlug: "charlie",
      status: "none",
    }),
    record({
      id: "org-4",
      clientName: "Delta Trial",
      clientSlug: "delta",
      status: "trialing",
      planId: "plan-pro",
      planName: "Pro",
      expiresAt: "2026-09-20",
      sourceEntity: "subscriptions",
      subscriptionId: "sub-4",
      accessAllowed: true,
      accessReason: "ok",
    }),
  ];

  it("filters by query, plan name, plan id and status", () => {
    expect(filterAdminSubscriptionRecords(records, { query: "alpha" })).toHaveLength(1);
    expect(filterAdminSubscriptionRecords(records, { plan: "basic" })).toHaveLength(1);
    expect(filterAdminSubscriptionRecords(records, { planId: "plan-pro" })).toHaveLength(2);
    expect(filterAdminSubscriptionRecords(records, { status: "expired" })).toHaveLength(1);
    expect(filterAdminSubscriptionRecords(records, { status: "trialing" })).toHaveLength(1);
  });

  it("treats canceled and cancelled as the same filter", () => {
    const withCancel = [
      ...records,
      record({
        id: "org-5",
        clientName: "Echo Cancel",
        status: "canceled",
        subscriptionId: "sub-5",
        sourceEntity: "subscriptions",
      }),
    ];
    expect(filterAdminSubscriptionRecords(withCancel, { status: "cancelled" })).toHaveLength(1);
    expect(filterAdminSubscriptionRecords(withCancel, { status: "canceled" })).toHaveLength(1);
  });

  it("filters by expiration window", () => {
    expect(
      filterAdminSubscriptionRecords(records, {
        expiresFrom: "2026-09-01",
        expiresTo: "2026-10-31",
      }).map((item) => item.id)
    ).toEqual(["org-4", "org-1"]);
  });

  it("orders by expiration ascending with missing dates last", () => {
    const ordered = filterAdminSubscriptionRecords(records, {});
    expect(ordered.map((item) => item.id)).toEqual(["org-2", "org-4", "org-1", "org-3"]);
    expect(compareSubscriptionExpiration(records[1]!, records[0]!)).toBeLessThan(0);
  });

  it("builds overview with current subscription states", () => {
    expect(buildAdminSubscriptionOverview(records)).toMatchObject({
      totalClients: 4,
      activeSubscriptions: 1,
      trialingSubscriptions: 1,
      expiredSubscriptions: 1,
      noneSubscriptions: 1,
      cancelledSubscriptions: 0,
    });
    expect(findNextSubscriptionExpirations(records).map((item) => item.id)).toEqual([
      "org-4",
      "org-1",
    ]);
  });

  it("picks the newest subscription per organization by created_at", () => {
    const picked = pickCurrentSubscription([
      { id: "old", created_at: "2026-01-01T00:00:00.000Z", org_id: "org-1" },
      { id: "new", created_at: "2026-06-01T00:00:00.000Z", org_id: "org-1" },
    ]);
    expect(picked?.id).toBe("new");
  });
});

describe("admin subscription access description uses current gate", () => {
  it("allows active/trialing/past_due and blocks expired/canceled/none", () => {
    expect(describeSubscriptionAccessForAdmin("active").accessAllowed).toBe(true);
    expect(describeSubscriptionAccessForAdmin("trialing").accessAllowed).toBe(true);
    expect(describeSubscriptionAccessForAdmin("past_due").accessAllowed).toBe(true);
    expect(describeSubscriptionAccessForAdmin("expired").accessAllowed).toBe(false);
    expect(describeSubscriptionAccessForAdmin("canceled").accessAllowed).toBe(false);
    expect(describeSubscriptionAccessForAdmin("cancelled").accessAllowed).toBe(false);
    expect(describeSubscriptionAccessForAdmin(null).accessAllowed).toBe(false);
  });
});

describe("admin plan and subscription validation schemas", () => {
  it("rejects inverted expiration range on list filters", () => {
    const parsed = adminSubscriptionListQuerySchema.safeParse({
      expires_from: "2026-10-01",
      expires_to: "2026-09-01",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts plan_id filter as uuid", () => {
    const parsed = adminSubscriptionListQuerySchema.safeParse({
      plan_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(parsed.success).toBe(true);
  });

  it("validates create/update plan payloads", () => {
    expect(
      createAdminPlanSchema.safeParse({
        name: "Pro",
        amount: "99.90",
        billing_interval: "monthly",
        is_active: true,
      }).success
    ).toBe(true);

    expect(
      createAdminPlanSchema.safeParse({
        name: "",
        amount: "99.90",
        billing_interval: "monthly",
      }).success
    ).toBe(false);

    expect(
      updateAdminPlanSchema.safeParse({
        plan_id: "22222222-2222-4222-8222-222222222222",
        name: "Pro Plus",
        description: "Atualizado",
        amount: "149.90",
        billing_interval: "yearly",
      }).success
    ).toBe(true);
  });

  it("validates create subscription with org_id and rejects canceled create", () => {
    expect(
      createAdminSubscriptionSchema.safeParse({
        org_id: "11111111-1111-4111-8111-111111111111",
        plan_id: "22222222-2222-4222-8222-222222222222",
        period_start: "2026-09-01",
        period_end: "2026-08-01",
        status: "active",
      }).success
    ).toBe(false);

    expect(
      createAdminSubscriptionSchema.safeParse({
        org_id: "11111111-1111-4111-8111-111111111111",
        plan_id: "22222222-2222-4222-8222-222222222222",
        period_start: "2026-09-01",
        period_end: "2026-10-01",
        status: "active",
        contracted_amount: "199.90",
      }).success
    ).toBe(true);

    expect(
      createAdminSubscriptionSchema.safeParse({
        org_id: "11111111-1111-4111-8111-111111111111",
        plan_id: "22222222-2222-4222-8222-222222222222",
        period_start: "2026-09-01",
        period_end: "2026-10-01",
        status: "canceled",
      }).success
    ).toBe(false);
  });

  it("blocks cancelled status on status update schema", () => {
    expect(
      updateAdminSubscriptionStatusSchema.safeParse({
        subscription_id: "33333333-3333-4333-8333-333333333333",
        status: "cancelled",
      }).success
    ).toBe(false);
  });

  it("validates plan delete and cancel schemas", () => {
    expect(
      deleteAdminPlanSchema.safeParse({
        plan_id: "22222222-2222-4222-8222-222222222222",
      }).success
    ).toBe(true);
    expect(
      cancelAdminSubscriptionSchema.safeParse({
        subscription_id: "33333333-3333-4333-8333-333333333333",
      }).success
    ).toBe(true);
  });
});

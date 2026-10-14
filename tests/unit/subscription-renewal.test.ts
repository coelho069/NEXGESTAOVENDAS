import { describe, expect, it } from "vitest";
import { planSubscriptionRenewal } from "@/lib/domain/onboarding-visitor";

const base = { paymentRef: "pay-2", paidDate: "2026-11-10", today: "2026-11-10" };

describe("renovação Checkout Pro na mesma assinatura", () => {
  it("não vencida: empilha 30 dias a partir do period_end atual", () => {
    const plan = planSubscriptionRenewal({
      ...base,
      latest: { id: "s1", status: "active", periodEnd: "2026-11-13", providerRef: "pay-1" },
    });
    expect(plan).toEqual({ kind: "extend", subscriptionId: "s1", periodStart: null, periodEnd: "2026-12-13" });
  });
  it("vencida (status ainda active): reancora na aprovação + 30", () => {
    const plan = planSubscriptionRenewal({
      ...base,
      paidDate: "2026-11-20",
      today: "2026-11-20",
      latest: { id: "s1", status: "active", periodEnd: "2026-11-13", providerRef: "pay-1" },
    });
    expect(plan).toEqual({ kind: "extend", subscriptionId: "s1", periodStart: "2026-11-20", periodEnd: "2026-12-20" });
  });
  it("vence hoje conta como vencida", () => {
    const plan = planSubscriptionRenewal({
      ...base,
      latest: { id: "s1", status: "active", periodEnd: "2026-11-10", providerRef: "pay-1" },
    });
    expect(plan).toMatchObject({ kind: "extend", periodStart: "2026-11-10", periodEnd: "2026-12-10" });
  });
  it("idempotente: mesmo pagamento já aplicado não estende de novo", () => {
    const plan = planSubscriptionRenewal({
      ...base,
      latest: { id: "s1", status: "active", periodEnd: "2026-12-13", providerRef: "pay-2" },
    });
    expect(plan).toEqual({ kind: "already_applied", subscriptionId: "s1" });
  });
  it("cancelada/reembolsada: nova assinatura na mesma org a partir da aprovação", () => {
    for (const status of ["canceled", "cancelled", "expired"]) {
      const plan = planSubscriptionRenewal({
        ...base,
        latest: { id: "s1", status, periodEnd: "2026-12-01", providerRef: "pay-1" },
      });
      expect(plan).toEqual({ kind: "new_subscription", periodStart: "2026-11-10", periodEnd: "2026-12-10" });
    }
  });
  it("sem assinatura anterior: nova assinatura", () => {
    expect(planSubscriptionRenewal({ ...base, latest: null }).kind).toBe("new_subscription");
  });
});

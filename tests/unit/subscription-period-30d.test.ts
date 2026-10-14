import { describe, expect, it } from "vitest";
import {
  addBillingPeriodStart,
  billingPeriodStartFromPaidAt,
  formatDateOnlyUtc,
} from "@/lib/domain/mercadopago-assinaturas";
import {
  applyPeriodEndExpiry,
  businessDateToday,
  gateTenantSubscriptionAccess,
  periodEndFromSubscriptionLookup,
  type SubscriptionCheck,
} from "@/lib/domain/subscription-access";

const active: SubscriptionCheck = { recordedStatus: "active", effectiveState: "active", reason: "ok" };

describe("período mensal = pagamento + 30 dias", () => {
  it("soma exatamente 30 dias à aprovação", () => {
    const start = billingPeriodStartFromPaidAt("2026-10-14T12:55:44.000Z");
    const end = addBillingPeriodStart(start, "monthly");
    expect(end.getTime() - start.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    expect(formatDateOnlyUtc(end)).toBe("2026-11-13");
  });
  it("31 de janeiro + 30 dias = 2 de março (não fim de fevereiro)", () => {
    const end = addBillingPeriodStart(new Date("2027-01-31T10:00:00Z"), "monthly");
    expect(formatDateOnlyUtc(end)).toBe("2027-03-02");
  });
  it("sem paidAt ou inválido usa agora", () => {
    const now = new Date("2026-10-14T00:00:00Z");
    expect(billingPeriodStartFromPaidAt(null, now)).toBe(now);
    expect(billingPeriodStartFromPaidAt("lixo", now)).toBe(now);
  });
});

describe("bloqueio após expiração", () => {
  it("permite antes do period_end", () => {
    const c = applyPeriodEndExpiry(active, "2026-11-13", new Date("2026-11-12T23:00:00-04:00"));
    expect(gateTenantSubscriptionAccess(c).allowed).toBe(true);
  });
  it("bloqueia a partir do dia do period_end (America/Manaus)", () => {
    const c = applyPeriodEndExpiry(active, "2026-11-13", new Date("2026-11-13T00:30:00-04:00"));
    expect(c.effectiveState).toBe("expired");
    expect(gateTenantSubscriptionAccess(c).allowed).toBe(false);
    expect(gateTenantSubscriptionAccess(c).reason).toBe("expired");
  });
  it("usa a data de Manaus, não UTC", () => {
    expect(businessDateToday(new Date("2026-11-13T02:00:00Z"))).toBe("2026-11-12");
  });
  it("não mexe em canceled/unavailable nem sem period_end", () => {
    const canceled: SubscriptionCheck = { recordedStatus: "canceled", effectiveState: "canceled", reason: "canceled" };
    expect(applyPeriodEndExpiry(canceled, "2000-01-01")).toBe(canceled);
    expect(applyPeriodEndExpiry(active, null)).toBe(active);
  });
  it("lê period_end da consulta", () => {
    expect(periodEndFromSubscriptionLookup({ data: [{ status: "active", period_end: "2026-11-13" }], error: null })).toBe("2026-11-13");
    expect(periodEndFromSubscriptionLookup({ data: null, error: { message: "x" } })).toBeNull();
  });
});

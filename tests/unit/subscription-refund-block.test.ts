import { describe, expect, it } from "vitest";
import {
  applyApprovedRefundBlock,
  gateTenantSubscriptionAccess,
  normalizePayerEmail,
  payerEmailFromSubscriptionLookup,
  resolveSubscriptionCheck,
  subscriptionBlockTitle,
} from "@/lib/domain/subscription-access";

describe("approved refund blocks subscription access", () => {
  it("blocks an active subscription when payer has an approved refund", () => {
    const check = applyApprovedRefundBlock(
      resolveSubscriptionCheck({ kind: "success", recordedStatus: "active" }),
      true
    );
    const decision = gateTenantSubscriptionAccess(check);
    expect(decision.allowed).toBe(false);
    expect(decision.effectiveState).toBe("canceled");
    expect(decision.reason).toBe("refunded");
    expect(subscriptionBlockTitle(decision.effectiveState, decision.reason)).toBe(
      "Assinatura cancelada (reembolsada)"
    );
  });

  it("keeps access when there is no approved refund", () => {
    const decision = gateTenantSubscriptionAccess(
      applyApprovedRefundBlock(resolveSubscriptionCheck({ kind: "success", recordedStatus: "trialing" }), false)
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("ok");
  });

  it("keeps fail-open unavailable when refund lookup failed (false)", () => {
    const decision = gateTenantSubscriptionAccess(
      applyApprovedRefundBlock(resolveSubscriptionCheck({ kind: "unavailable", detail: "x" }), false)
    );
    expect(decision.allowed).toBe(true);
    expect(decision.effectiveState).toBe("unavailable");
  });

  it("plain canceled keeps the canceled reason and title", () => {
    const decision = gateTenantSubscriptionAccess(
      resolveSubscriptionCheck({ kind: "success", recordedStatus: "canceled" })
    );
    expect(decision.reason).toBe("canceled");
    expect(subscriptionBlockTitle(decision.effectiveState, decision.reason)).toBe("Assinatura cancelada");
  });

  it("normalizes payer e-mail case-insensitively", () => {
    expect(normalizePayerEmail("  Foo@Example.COM ")).toBe("foo@example.com");
    expect(normalizePayerEmail("")).toBeNull();
    expect(payerEmailFromSubscriptionLookup({ data: [{ status: "active", mp_payer_email: "A@B.co" }], error: null })).toBe("a@b.co");
    expect(payerEmailFromSubscriptionLookup({ data: null, error: { message: "x" } })).toBeNull();
  });
});

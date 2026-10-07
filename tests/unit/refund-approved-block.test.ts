import { describe, expect, it, vi } from "vitest";
import {
  assessClientRefundEligibility,
  presentClientRefundPayments,
  visibleClientRefundPayments,
  type ClientCheckoutPayment,
  type ClientRefundActor,
} from "@/lib/domain/client-refund-eligibility";
import { createOwnedRefundRequest } from "@/lib/server/client-refund-requests";
import type { RefundRequestStore } from "@/lib/server/refund-requests";

const actor: ClientRefundActor = {
  userId: "22222222-2222-4222-8222-222222222222",
  email: "client@example.com",
  orgId: "33333333-3333-4333-8333-333333333333",
};

function payment(overrides: Partial<ClientCheckoutPayment> = {}): ClientCheckoutPayment {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    payerEmail: "client@example.com",
    mpPaymentId: "123456789",
    mpPaymentStatus: "approved",
    mpPaymentPaidAt: "2026-10-06T15:00:00.000Z",
    onboardingUserId: actor.userId,
    onboardingOrganizationId: actor.orgId,
    ...overrides,
  };
}

const now = new Date("2026-10-08T15:00:00.000Z");

describe("approved refund blocks new requests", () => {
  it("marks a payment with an approved refund as already_refunded", () => {
    expect(
      assessClientRefundEligibility({ actor, payment: payment(), now, openRequest: false, refundApproved: true })
    ).toEqual({ eligible: false, reason: "already_refunded" });
  });

  it("hides refunded payments from the client list, even if a later request was rejected", () => {
    const views = presentClientRefundPayments({
      actor,
      checkouts: [payment(), payment({ id: "x2", mpPaymentId: "987654321" })],
      requests: [
        { mpPaymentId: "123456789", status: "approved", createdAt: "2026-10-06T16:00:00.000Z" },
        { mpPaymentId: "123456789", status: "rejected", createdAt: "2026-10-07T16:00:00.000Z" },
      ],
      now,
    });
    const refunded = views.find((view) => view.mpPaymentId === "123456789");
    expect(refunded?.eligible).toBe(false);
    expect(visibleClientRefundPayments(views).map((view) => view.mpPaymentId)).toEqual(["987654321"]);
  });

  it("refuses to insert a request for an already refunded payment", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const store = {
      findByMutationId: vi.fn(async () => null),
      findById: vi.fn(async () => null),
      insert,
      findCheckout: vi.fn(async () => null),
      updateIfStatus: vi.fn(async () => null),
      listRecent: vi.fn(async () => []),
    } as unknown as RefundRequestStore;
    const result = await createOwnedRefundRequest(store, {
      actor,
      checkout: payment(),
      hasOpenRequest: false,
      hasApprovedRequest: true,
      clientMutationId: "44444444-4444-4444-8444-444444444444",
      mpPaymentId: "123456789",
      reason: "arrependimento",
      notes: "",
      intensiveUseDeclared: false,
      now,
    });
    expect(result).toEqual({ ok: false, error: "refund_already_approved", status: 409 });
    expect(insert).not.toHaveBeenCalled();
  });
});

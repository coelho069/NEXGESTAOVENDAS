import { describe, expect, it } from "vitest";
import { getPaymentAdapter } from "@/lib/adapters/payment";
import { resolvePaymentAttempt } from "@/lib/domain/payment-attempt";
import {
  assertPaymentTransition,
  canTransitionPayment,
  isPaymentOutcomeUnknown,
} from "@/lib/domain/payment-state";

describe("payment state machine", () => {
  it("allows only explicit forward transitions", () => {
    expect(canTransitionPayment("pending", "authorized")).toBe(true);
    expect(canTransitionPayment("authorized", "captured")).toBe(true);
    expect(canTransitionPayment("unknown", "failed")).toBe(true);
    expect(canTransitionPayment("captured", "failed")).toBe(false);
    expect(canTransitionPayment("failed", "captured")).toBe(false);
    expect(canTransitionPayment("refunded", "captured")).toBe(false);
  });

  it("rejects arbitrary transitions", () => {
    expect(() => assertPaymentTransition("unknown", "captured")).not.toThrow();
    expect(() => assertPaymentTransition("captured", "failed")).toThrow(
      "Invalid payment status transition"
    );
  });

  it("keeps unknown distinct from success", () => {
    expect(isPaymentOutcomeUnknown("unknown")).toBe(true);
    expect(resolvePaymentAttempt({ status: "unknown", message: "timeout" })).toEqual({
      kind: "unknown",
      message: "timeout",
    });
    expect(resolvePaymentAttempt({ status: "unknown", message: "" }).kind).not.toBe("capture");
  });
});

describe("payment adapters", () => {
  it("never simulates a configured result for an unavailable provider", () => {
    const adapter = getPaymentAdapter("card");
    expect(adapter.authorize("10.00").status).toBe("not_configured");
    expect(adapter.capture("10.00").status).toBe("not_configured");
    expect(adapter.reconcile("10.00").status).toBe("not_configured");
    expect(resolvePaymentAttempt(adapter.process("10.00")).kind).toBe("keep_draft");
  });

  it("uses the server record as the source of truth for cash reconciliation", () => {
    const adapter = getPaymentAdapter("cash");
    expect(adapter.capture("10.00", { clientMutationId: "mutation" }).status).toBe("captured");
    expect(adapter.reconcile("10.00", { clientMutationId: "mutation" }).status).toBe("unknown");
  });
});

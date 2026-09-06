import { afterEach, describe, expect, it, vi } from "vitest";
import { bindStripeCardAdapter, getPaymentAdapter } from "@/lib/adapters/payment";
import { StripeCardPaymentAdapter, type StripeCardGateway } from "@/lib/adapters/stripe-card";
import { resolvePaymentAttempt } from "@/lib/domain/payment-attempt";
import {
  assertPaymentTransition,
  canTransitionPayment,
} from "@/lib/domain/payment-state";
import {
  classifySilentHttpSuccess,
  isStripeWebhookEventAllowed,
  mustNotInventRefundCash,
  reconcileStripePaymentIntent,
  stripeAmountFromBrl,
  webhookEventToPaymentState,
  cardRefundStatusPendingExternal,
} from "@/lib/domain/stripe-card";
import { POST as stripeWebhookPost } from "@/app/api/payments/stripe/webhook/route";

function snapshot(overrides: Partial<{
  id: string;
  status: string;
  amount: number;
  currency: string;
  livemode: boolean;
  received: boolean;
}> = {}) {
  return {
    id: "pi_test_123",
    status: "requires_capture",
    amount: 1000,
    currency: "brl",
    livemode: false,
    received: true,
    ...overrides,
  };
}

function fakeGateway(overrides: Partial<StripeCardGateway> = {}): StripeCardGateway {
  return {
    health: async () => ({ ok: true, testmode: true, message: "ok" }),
    authorize: async () => snapshot(),
    capture: async () => snapshot({ status: "succeeded" }),
    cancel: async () => snapshot({ status: "canceled" }),
    retrieve: async () => snapshot({ status: "succeeded" }),
    ...overrides,
  };
}

describe("card payment state machine", () => {
  afterEach(() => {
    bindStripeCardAdapter(null);
  });

  it("keeps card not_configured until a healthy Stripe adapter is bound", () => {
    const adapter = getPaymentAdapter("card");
    expect(adapter.authorize("10.00")).toMatchObject({ status: "not_configured" });
    expect(resolvePaymentAttempt(adapter.process("10.00")).kind).toBe("keep_draft");
  });

  it("does not treat authorize as captured or sale-confirmed", async () => {
    const adapter = new StripeCardPaymentAdapter(fakeGateway());
    bindStripeCardAdapter(adapter);

    const authorized = await getPaymentAdapter("card").authorize("10.00", {
      clientMutationId: "11111111-1111-4111-8111-111111111111",
    });
    expect(authorized.status).toBe("authorized");
    expect(authorized.providerReference).toBe("pi_test_123");
    expect(authorized.status).not.toBe("captured");
    expect(canTransitionPayment("authorized", "captured")).toBe(true);
    expect(canTransitionPayment("authorized", "refunded")).toBe(false);
    expect(() => assertPaymentTransition("authorized", "captured")).not.toThrow();
  });

  it("captures only after PaymentIntent succeeded", async () => {
    const adapter = new StripeCardPaymentAdapter(
      fakeGateway({
        capture: async () => snapshot({ status: "succeeded" }),
      })
    );
    const captured = await adapter.capture("10.00", { providerReference: "pi_test_123" });
    expect(captured.status).toBe("captured");
    expect(captured.providerReference).toBe("pi_test_123");
  });

  it("marks HTTP 200 without PI succeeded as unknown and never captured", async () => {
    const adapter = new StripeCardPaymentAdapter(
      fakeGateway({
        capture: async () => snapshot({ status: "processing" }),
      })
    );
    const result = await adapter.capture("10.00", { providerReference: "pi_test_123" });
    expect(result.status).toBe("unknown");
    expect(result.status).not.toBe("captured");
    expect(classifySilentHttpSuccess(true, snapshot({ status: "processing" }), "capture")).toBe(
      "unknown"
    );
    expect(classifySilentHttpSuccess(true, snapshot({ received: false, id: "", status: "" }), "capture")).toBe(
      "unknown"
    );
  });

  it("maps Stripe timeout to unknown", async () => {
    const adapter = new StripeCardPaymentAdapter(
      fakeGateway({
        capture: async () => {
          throw new Error("timeout");
        },
      })
    );
    await expect(adapter.capture("10.00", { providerReference: "pi_test_123" })).resolves.toMatchObject({
      status: "unknown",
    });
  });
});

describe("Stripe reconcile mismatch → unknown", () => {
  it("rejects provider_ref mismatch", () => {
    const decision = reconcileStripePaymentIntent({
      expectedProviderRef: "pi_expected",
      expectedAmount: "10.00",
      snapshot: snapshot({ id: "pi_other" }),
    });
    expect(decision.status).toBe("unknown");
    expect(decision.mismatch).toBe(true);
  });

  it("rejects amount or currency mismatch", () => {
    expect(
      reconcileStripePaymentIntent({
        expectedProviderRef: "pi_test_123",
        expectedAmount: "10.00",
        snapshot: snapshot({ amount: 999, status: "succeeded" }),
      }).status
    ).toBe("unknown");
    expect(
      reconcileStripePaymentIntent({
        expectedProviderRef: "pi_test_123",
        expectedAmount: "10.00",
        snapshot: snapshot({ currency: "usd", status: "succeeded" }),
      }).status
    ).toBe("unknown");
  });

  it("captures only when PI succeeded and amount+currency match", () => {
    const decision = reconcileStripePaymentIntent({
      expectedProviderRef: "pi_test_123",
      expectedAmount: "10.00",
      snapshot: snapshot({ status: "succeeded", amount: stripeAmountFromBrl("10.00") }),
    });
    expect(decision.status).toBe("captured");
    expect(decision.mismatch).toBe(false);
  });

  it("keeps requires_capture as authorized, not captured", () => {
    const decision = reconcileStripePaymentIntent({
      expectedProviderRef: "pi_test_123",
      expectedAmount: "10.00",
      snapshot: snapshot({ status: "requires_capture" }),
    });
    expect(decision.status).toBe("authorized");
  });
});

describe("fake Stripe webhook", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("allowlists payment_intent and refund events", () => {
    expect(isStripeWebhookEventAllowed("payment_intent.succeeded")).toBe(true);
    expect(isStripeWebhookEventAllowed("payment_intent.payment_failed")).toBe(true);
    expect(isStripeWebhookEventAllowed("payment_intent.canceled")).toBe(true);
    expect(isStripeWebhookEventAllowed("charge.refunded")).toBe(true);
    expect(isStripeWebhookEventAllowed("refund.updated")).toBe(true);
    expect(isStripeWebhookEventAllowed("customer.created")).toBe(false);
    expect(webhookEventToPaymentState("payment_intent.succeeded")).toBe("captured");
    expect(webhookEventToPaymentState("charge.refunded")).toBe("pending_external");
  });

  it("keeps card refund pending_external and never invents refund_cash", () => {
    expect(cardRefundStatusPendingExternal()).toBe("pending_external");
    expect(mustNotInventRefundCash("card")).toBe(true);
    expect(mustNotInventRefundCash("cash")).toBe(false);
  });

  it("rejects unsigned webhooks with 400", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_placeholder");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_placeholder");
    const { POST } = await import("@/app/api/payments/stripe/webhook/route");
    const response = await POST(
      new Request("http://localhost/api/payments/stripe/webhook", {
        method: "POST",
        body: JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" }),
      })
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "stripe_webhook_unsigned" });
  });

  it("rejects invalid signatures with 400", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_placeholder");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_placeholder");
    const response = await stripeWebhookPost(
      new Request("http://localhost/api/payments/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "t=1,v1=deadbeef" },
        body: JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" }),
      })
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "stripe_webhook_invalid_signature",
    });
  });
});

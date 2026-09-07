import { afterEach, describe, expect, it, vi } from "vitest";
import { bindStripePixAdapter, getPaymentAdapter } from "@/lib/adapters/payment";
import { StripePixPaymentAdapter, type StripePixGateway } from "@/lib/adapters/stripe-pix";
import { resolvePaymentAttempt } from "@/lib/domain/payment-attempt";
import {
  classifySilentPixHttpSuccess,
  extractPixQr,
  isPixStripeObject,
  mapStripePixIntentStatus,
  mustNotInventRefundCash,
  pixRefundStatusPendingExternal,
  reconcileStripePixPaymentIntent,
} from "@/lib/domain/stripe-pix";
import { executePixPayment, getPixAdapterHealth } from "@/lib/server/pix-payment";
import { probeStripePixHealth } from "@/lib/server/stripe-pix";
import type { PixPaymentInput } from "@/lib/validation/schemas";

vi.mock("@/lib/server/stripe-pix", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/stripe-pix")>();
  return {
    ...actual,
    probeStripePixHealth: vi.fn(),
  };
});

const probeStripePixHealthMock = vi.mocked(probeStripePixHealth);

function snapshot(overrides: Partial<{
  id: string;
  status: string;
  amount: number;
  currency: string;
  livemode: boolean;
  received: boolean;
}> = {}) {
  return {
    id: "pi_pix_123",
    status: "requires_action",
    amount: 1000,
    currency: "brl",
    livemode: false,
    received: true,
    qr: {
      data: "00020126pix-payload",
      imageUrlPng: "https://files.stripe.com/qr.png",
    },
    ...overrides,
  };
}

function fakeGateway(overrides: Partial<StripePixGateway> = {}): StripePixGateway {
  return {
    health: async () => ({ ok: true, testmode: true, message: "ok" }),
    create: async () => snapshot(),
    cancel: async () => snapshot({ status: "canceled" }),
    retrieve: async () => snapshot({ status: "succeeded" }),
    ...overrides,
  };
}

function createInput(): PixPaymentInput {
  return {
    action: "create",
    store_id: "11111111-1111-4111-8111-111111111111",
    amount: "10.00",
    client_mutation_id: "22222222-2222-4222-8222-222222222222",
    discount: "0.00",
    items: [
      {
        product_id: "33333333-3333-4333-8333-333333333333",
        quantity: 1,
        unit_price: "10.00",
        discount: "0.00",
      },
    ],
  };
}

describe("PIX checkout hold flag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    probeStripePixHealthMock.mockReset();
  });

  it("holds health when PIX_CHECKOUT_ENABLED is unset or false", async () => {
    delete process.env.PIX_CHECKOUT_ENABLED;
    const unset = await getPixAdapterHealth();
    expect(unset.configured).toBe(false);
    expect(unset.testmode).toBe(false);
    expect(unset.reason).toBe("pix_checkout_hold");
    expect(unset.message).toMatch(/hold/i);
    expect(probeStripePixHealthMock).not.toHaveBeenCalled();

    vi.stubEnv("PIX_CHECKOUT_ENABLED", "false");
    const held = await getPixAdapterHealth();
    expect(held.configured).toBe(false);
    expect(held.testmode).toBe(false);
    expect(held.reason).toBe("pix_checkout_hold");
    expect(probeStripePixHealthMock).not.toHaveBeenCalled();
  });

  it("blocks executePixPayment before Stripe when hold is on", async () => {
    vi.stubEnv("PIX_CHECKOUT_ENABLED", "false");
    const result = await executePixPayment(
      {} as never,
      createInput(),
      "33333333-3333-4333-8333-333333333333"
    );
    expect(result).toMatchObject({
      status: "not_configured",
      configured: false,
    });
    expect(result.sale_confirmed).not.toBe(true);
    expect(probeStripePixHealthMock).not.toHaveBeenCalled();
  });

  it("keeps prior health behavior when PIX_CHECKOUT_ENABLED=true", async () => {
    vi.stubEnv("PIX_CHECKOUT_ENABLED", "true");
    probeStripePixHealthMock.mockResolvedValue({
      ok: true,
      configured: true,
      testmode: true,
      message: "Stripe testmode ok",
    });
    await expect(getPixAdapterHealth()).resolves.toEqual({
      configured: true,
      testmode: true,
      message: "Stripe testmode ok",
      reason: undefined,
    });
    expect(probeStripePixHealthMock).toHaveBeenCalledTimes(1);
  });
});

describe("PIX payment state machine", () => {
  afterEach(() => {
    bindStripePixAdapter(null);
  });

  it("keeps pix not_configured until a healthy Stripe adapter is bound", () => {
    const adapter = getPaymentAdapter("pix");
    expect(adapter.authorize("10.00")).toMatchObject({ status: "not_configured" });
    expect(resolvePaymentAttempt(adapter.process("10.00")).kind).toBe("keep_draft");
  });

  it("treats create/QR as pending and never as confirmed sale", async () => {
    const adapter = new StripePixPaymentAdapter(fakeGateway());
    bindStripePixAdapter(adapter);

    const created = await getPaymentAdapter("pix").authorize("10.00", {
      clientMutationId: "11111111-1111-4111-8111-111111111111",
    });
    expect(created.status).toBe("pending");
    expect(created.status).not.toBe("captured");
    expect(created.providerReference).toBe("pi_pix_123");
    expect(created.qr?.data).toBe("00020126pix-payload");
    expect(mapStripePixIntentStatus("requires_action")).toBe("pending");
    expect(mapStripePixIntentStatus("succeeded")).toBe("captured");
  });

  it("does not treat capture() as a PIX confirmation path", async () => {
    const adapter = new StripePixPaymentAdapter(fakeGateway());
    const captured = await adapter.capture("10.00", { providerReference: "pi_pix_123" });
    expect(captured.status).toBe("unknown");
    expect(captured.status).not.toBe("captured");
  });

  it("marks silent HTTP success without PI body as unknown", () => {
    expect(classifySilentPixHttpSuccess(true, snapshot({ received: false, id: "", status: "" }), "create")).toBe(
      "unknown"
    );
    expect(classifySilentPixHttpSuccess(true, snapshot(), "create")).toBeNull();
  });

  it("maps Stripe timeout to unknown", async () => {
    const adapter = new StripePixPaymentAdapter(
      fakeGateway({
        create: async () => {
          throw new Error("timeout");
        },
      })
    );
    await expect(adapter.authorize("10.00")).resolves.toMatchObject({
      status: "unknown",
    });
  });
});

describe("PIX reconcile and webhook routing", () => {
  it("keeps requires_action as pending, not captured", () => {
    const decision = reconcileStripePixPaymentIntent({
      expectedProviderRef: "pi_pix_123",
      expectedAmount: "10.00",
      snapshot: snapshot({ status: "requires_action" }),
    });
    expect(decision.status).toBe("pending");
    expect(decision.status).not.toBe("captured");
  });

  it("captures only when PI succeeded and amount matches", () => {
    const decision = reconcileStripePixPaymentIntent({
      expectedProviderRef: "pi_pix_123",
      expectedAmount: "10.00",
      snapshot: snapshot({ status: "succeeded", amount: 1000 }),
    });
    expect(decision.status).toBe("captured");
    expect(decision.mismatch).toBe(false);
  });

  it("detects PIX Stripe objects and extracts QR", () => {
    expect(
      isPixStripeObject({
        payment_method_types: ["pix"],
        id: "pi_pix_123",
      })
    ).toBe(true);
    expect(
      isPixStripeObject({
        payment_method_types: ["card"],
        id: "pi_card_123",
      })
    ).toBe(false);
    expect(
      extractPixQr({
        type: "pix_display_qr_code",
        pix_display_qr_code: { data: "00020126abc", image_url_png: "https://qr" },
      })?.data
    ).toBe("00020126abc");
  });

  it("keeps PIX refund pending_external and never invents refund_cash", () => {
    expect(pixRefundStatusPendingExternal()).toBe("pending_external");
    expect(mustNotInventRefundCash("pix")).toBe(true);
    expect(mustNotInventRefundCash("cash")).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isPixUnavailableError,
  NO_PAYMENT_PROVIDER,
  PIX_NOT_ENABLED_ON_ACCOUNT,
  PIX_FALLBACK_BANNER_MESSAGE,
} from "@/lib/domain/payment-fallback";
import { createPaymentWithFallback } from "@/lib/server/payment-fallback";

const mocks = vi.hoisted(() => ({
  paymentIntentsCreate: vi.fn(),
  mpCreate: vi.fn(),
}));

vi.mock("stripe", () => {
  class Stripe {
    paymentIntents = { create: mocks.paymentIntentsCreate };
    constructor(_secretKey: string, _config?: Record<string, unknown>) {}
  }
  return { default: Stripe };
});

vi.mock("@/lib/server/mercadopago", () => ({
  getMercadoPagoEnv: vi.fn(),
  isMercadoPagoCheckoutEnabled: vi.fn(),
  createMercadoPagoPixGateway: vi.fn(() => ({ create: mocks.mpCreate })),
}));

import { getMercadoPagoEnv, isMercadoPagoCheckoutEnabled } from "@/lib/server/mercadopago";

const STRIPE_ENV = {
  STRIPE_SECRET_KEY: "sk_test_abc123",
  STRIPE_WEBHOOK_SECRET: "whsec_abc123",
  STRIPE_PIX_ENABLED: "true",
};

function pixUnavailableError() {
  const err = new Error(
    "The payment method type provided: pix is not enabled for this account."
  ) as Error & Record<string, unknown>;
  err.type = "invalid_request_error";
  err.code = "payment_method_not_available";
  return err;
}

beforeEach(() => {
  mocks.paymentIntentsCreate.mockReset();
  mocks.mpCreate.mockReset();
  vi.mocked(getMercadoPagoEnv).mockReset();
  vi.mocked(isMercadoPagoCheckoutEnabled).mockReset();
});

describe("isPixUnavailableError", () => {
  it("matches the Stripe 'pix invalid / not enabled' refusals", () => {
    expect(
      isPixUnavailableError({
        type: "invalid_request_error",
        code: "payment_method_not_available",
        message: "The payment method type provided: pix is invalid for this account.",
      })
    ).toBe(true);
    expect(
      isPixUnavailableError({
        code: "parameter_invalid",
        param: "payment_method_types",
        message: "payment_method_types must be one of card.",
      })
    ).toBe(true);
    expect(
      isPixUnavailableError({
        type: "invalid_request_error",
        message: "pix is not activated for this account.",
      })
    ).toBe(true);
  });

  it("does not match unrelated Stripe failures", () => {
    expect(isPixUnavailableError(new Error("network timeout"))).toBe(false);
    expect(isPixUnavailableError({ code: "card_declined", message: "Your card was declined." })).toBe(false);
  });
});

describe("createPaymentWithFallback", () => {
  it("falls back to card when Stripe refuses PIX (200/ok, fallback true)", async () => {
    mocks.paymentIntentsCreate
      .mockRejectedValueOnce(pixUnavailableError())
      .mockResolvedValueOnce({ id: "pi_card_1", client_secret: "cs_card_1", status: "requires_capture" });

    vi.mocked(getMercadoPagoEnv).mockReturnValue({ configured: false, reason: "mercadopago_access_token_missing" });

    const result = await createPaymentWithFallback({
      amount: "10.00",
      clientMutationId: "22222222-2222-4222-8222-222222222222",
      storeId: "11111111-1111-4111-8111-111111111111",
      envSource: STRIPE_ENV,
    });

    expect(result).toMatchObject({
      ok: true,
      provider: "stripe",
      method: "card",
      fallback: true,
      code: PIX_NOT_ENABLED_ON_ACCOUNT,
      client_secret: "cs_card_1",
      message: PIX_FALLBACK_BANNER_MESSAGE,
    });
    expect(mocks.paymentIntentsCreate).toHaveBeenCalledTimes(2);
    expect(mocks.paymentIntentsCreate.mock.calls[0][0]).toMatchObject({ payment_method_types: ["pix"] });
    expect(mocks.paymentIntentsCreate.mock.calls[1][0]).toMatchObject({ payment_method_types: ["card"] });
  });

  it("falls back to Mercado Pago when card is also unavailable", async () => {
    mocks.paymentIntentsCreate
      .mockRejectedValueOnce(pixUnavailableError())
      .mockRejectedValueOnce(new Error("card_failed"));

    vi.mocked(getMercadoPagoEnv).mockReturnValue({
      configured: true,
      accessToken: "APP_USR_test",
      webhookSecret: "mp_whsec_test",
      timeoutMs: 15000,
    });
    vi.mocked(isMercadoPagoCheckoutEnabled).mockReturnValue(true);
    mocks.mpCreate.mockResolvedValueOnce({ id: "ORD123ABC", status: "pending" });

    const result = await createPaymentWithFallback({
      amount: "10.00",
      clientMutationId: "22222222-2222-4222-8222-222222222222",
      storeId: "11111111-1111-4111-8111-111111111111",
      envSource: STRIPE_ENV,
    });

    expect(result).toMatchObject({
      ok: true,
      provider: "mercadopago",
      method: "pix",
      fallback: true,
      code: PIX_NOT_ENABLED_ON_ACCOUNT,
    });
  });

  it("returns controlled NO_PAYMENT_PROVIDER when nothing is available", async () => {
    mocks.paymentIntentsCreate
      .mockRejectedValueOnce(pixUnavailableError())
      .mockRejectedValueOnce(new Error("card_failed"));
    vi.mocked(getMercadoPagoEnv).mockReturnValue({ configured: false, reason: "mercadopago_access_token_missing" });

    const result = await createPaymentWithFallback({ amount: "10.00", envSource: STRIPE_ENV });

    expect(result).toMatchObject({
      ok: false,
      provider: null,
      method: "other",
      fallback: true,
      code: NO_PAYMENT_PROVIDER,
      client_secret: null,
    });
  });

  it("skips PIX entirely when STRIPE_PIX_ENABLED is not true", async () => {
    mocks.paymentIntentsCreate.mockResolvedValueOnce({
      id: "pi_card_flag",
      client_secret: "cs_card_flag",
      status: "requires_capture",
    });
    vi.mocked(getMercadoPagoEnv).mockReturnValue({ configured: false, reason: "mercadopago_access_token_missing" });

    const result = await createPaymentWithFallback({
      amount: "10.00",
      envSource: { ...STRIPE_ENV, STRIPE_PIX_ENABLED: "false" },
    });

    expect(result).toMatchObject({ ok: true, provider: "stripe", method: "card", fallback: true });
    expect(mocks.paymentIntentsCreate).toHaveBeenCalledTimes(1);
    expect(mocks.paymentIntentsCreate.mock.calls[0][0]).toMatchObject({ payment_method_types: ["card"] });
  });
});


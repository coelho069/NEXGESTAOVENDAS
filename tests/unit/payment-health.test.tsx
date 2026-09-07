import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PaymentActions } from "@/components/pdv/sale-summary";
import { getPaymentAdapter } from "@/lib/adapters/payment";
import {
  fetchCardPaymentSelectable,
  fetchPixPaymentSelectable,
  isCardPaymentHealthSelectable,
  isPixPaymentHealthSelectable,
  isCheckoutPaymentSelectable,
} from "@/lib/adapters/payment-health";
import { executeCardPayment, getCardAdapterHealth } from "@/lib/server/card-payment";
import { probeStripeCardHealth } from "@/lib/server/stripe-card";
import type { CardPaymentInput } from "@/lib/validation/schemas";

vi.mock("@/lib/server/stripe-card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/stripe-card")>();
  return {
    ...actual,
    probeStripeCardHealth: vi.fn(),
  };
});

const probeStripeCardHealthMock = vi.mocked(probeStripeCardHealth);

function captureInput(): CardPaymentInput {
  return {
    action: "capture",
    store_id: "11111111-1111-4111-8111-111111111111",
    amount: "10.00",
    client_mutation_id: "22222222-2222-4222-8222-222222222222",
    provider_reference: "pi_test_hold",
    discount: "0.00",
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

describe("card checkout hold flag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    probeStripeCardHealthMock.mockReset();
  });

  it("holds health when CARD_CHECKOUT_ENABLED is unset or false", async () => {
    delete process.env.CARD_CHECKOUT_ENABLED;
    const unset = await getCardAdapterHealth();
    expect(unset.configured).toBe(false);
    expect(unset.testmode).toBe(false);
    expect(unset.reason).toBe("card_checkout_hold");
    expect(unset.message).toMatch(/hold/i);
    expect(probeStripeCardHealthMock).not.toHaveBeenCalled();

    vi.stubEnv("CARD_CHECKOUT_ENABLED", "false");
    const held = await getCardAdapterHealth();
    expect(held.configured).toBe(false);
    expect(held.testmode).toBe(false);
    expect(held.reason).toBe("card_checkout_hold");
    expect(
      isCardPaymentHealthSelectable({
        ok: true,
        status: 200,
        contentType: "application/json",
        body: { ...held, method: "card" },
      })
    ).toBe(false);
    expect(probeStripeCardHealthMock).not.toHaveBeenCalled();
  });

  it("blocks executeCardPayment before Stripe when hold is on", async () => {
    vi.stubEnv("CARD_CHECKOUT_ENABLED", "false");
    const result = await executeCardPayment(
      {} as never,
      captureInput(),
      "33333333-3333-4333-8333-333333333333"
    );
    expect(result).toMatchObject({
      status: "not_configured",
      configured: false,
    });
    expect(probeStripeCardHealthMock).not.toHaveBeenCalled();
  });

  it("keeps prior health behavior when CARD_CHECKOUT_ENABLED=true", async () => {
    vi.stubEnv("CARD_CHECKOUT_ENABLED", "true");
    probeStripeCardHealthMock.mockResolvedValue({
      ok: true,
      configured: true,
      testmode: true,
      message: "Stripe testmode ok",
    });
    await expect(getCardAdapterHealth()).resolves.toEqual({
      configured: true,
      testmode: true,
      message: "Stripe testmode ok",
      reason: undefined,
    });
    expect(probeStripeCardHealthMock).toHaveBeenCalledTimes(1);
  });
});

describe("card payment health fail-closed", () => {
  it("rejects 404 HTML and other non-JSON health responses", () => {
    expect(
      isCardPaymentHealthSelectable({
        ok: false,
        status: 404,
        contentType: "text/html; charset=utf-8",
        body: null,
      })
    ).toBe(false);
    expect(
      isCardPaymentHealthSelectable({
        ok: true,
        status: 200,
        contentType: "text/html",
        body: "<html>ok</html>",
      })
    ).toBe(false);
  });

  it("rejects not_configured JSON even when the route exists", () => {
    expect(
      isCardPaymentHealthSelectable({
        ok: true,
        status: 200,
        contentType: "application/json",
        body: { configured: false, testmode: false, method: "card" },
      })
    ).toBe(false);
    expect(
      isCardPaymentHealthSelectable({
        ok: true,
        status: 200,
        contentType: "application/json",
        body: { configured: true, testmode: false, method: "card" },
      })
    ).toBe(false);
    expect(
      isCardPaymentHealthSelectable({
        ok: true,
        status: 200,
        contentType: "application/json",
        body: { configured: true, testmode: true, status: "not_configured" },
      })
    ).toBe(false);
  });

  it("allows card only when health JSON is configured testmode", () => {
    expect(
      isCardPaymentHealthSelectable({
        ok: true,
        status: 200,
        contentType: "application/json",
        body: { configured: true, testmode: true, method: "card" },
      })
    ).toBe(true);
  });

  it("fails closed when the health fetch throws or returns HTML", async () => {
    await expect(fetchCardPaymentSelectable(async () => {
      throw new Error("network");
    })).resolves.toBe(false);

    await expect(
      fetchCardPaymentSelectable(async () =>
        new Response("<!DOCTYPE html><html><h1>Not Found</h1></html>", {
          status: 404,
          headers: { "content-type": "text/html" },
        })
      )
    ).resolves.toBe(false);
  });

  it("fails closed for PIX health unless configured testmode JSON", () => {
    expect(
      isPixPaymentHealthSelectable({
        ok: true,
        status: 200,
        contentType: "application/json",
        body: { configured: false, testmode: false, method: "pix" },
      })
    ).toBe(false);
    expect(
      isPixPaymentHealthSelectable({
        ok: true,
        status: 200,
        contentType: "application/json",
        body: { configured: true, testmode: true, method: "pix" },
      })
    ).toBe(true);
  });

  it("keeps cash selectable and electronic methods not_configured without health", async () => {
    expect(getPaymentAdapter("card").process("0.00").status).toBe("not_configured");
    expect(getPaymentAdapter("pix").process("0.00").status).toBe("not_configured");
    await expect(isCheckoutPaymentSelectable("cash")).resolves.toBe(true);
    await expect(isCheckoutPaymentSelectable("pix")).resolves.toBe(false);
    await expect(
      isCheckoutPaymentSelectable("pix", async () =>
        jsonResponse({ configured: false, testmode: false, method: "pix" })
      )
    ).resolves.toBe(false);
    await expect(
      fetchPixPaymentSelectable(async () =>
        jsonResponse({ configured: true, testmode: false, method: "pix" })
      )
    ).resolves.toBe(false);
    await expect(isCheckoutPaymentSelectable("voucher")).resolves.toBe(false);
    await expect(isCheckoutPaymentSelectable("other")).resolves.toBe(false);
    await expect(
      isCheckoutPaymentSelectable("card", async () =>
        jsonResponse({ configured: false, testmode: false, method: "card" })
      )
    ).resolves.toBe(false);
    await expect(
      isCheckoutPaymentSelectable("card", async () =>
        jsonResponse({ configured: true, testmode: true, method: "card" })
      )
    ).resolves.toBe(true);
  });
});

describe("PDV payment actions", () => {
  afterEach(() => {
    cleanup();
  });

  it("disables card and PIX and keeps cash available when health is unknown", () => {
    const onCard = vi.fn();
    const onPix = vi.fn();
    render(
      <PaymentActions
        disabled={false}
        cardSelectable={false}
        pixSelectable={false}
        onCash={() => undefined}
        onCard={onCard}
        onPix={onPix}
      />
    );

    const card = screen.getByTestId("checkout-card");
    const pix = screen.getByTestId("checkout-pix");
    const cash = screen.getByTestId("checkout-cash");
    expect(card).toBeDisabled();
    expect(pix).toBeDisabled();
    expect(cash).toBeEnabled();
    expect(card).toHaveTextContent("não configurado");
    expect(pix).toHaveTextContent("em breve");
    expect(pix).toHaveAttribute("aria-label", "PIX — em breve");
    card.click();
    pix.click();
    expect(onCard).not.toHaveBeenCalled();
    expect(onPix).not.toHaveBeenCalled();
  });

  it("keeps selectable PIX clickable without placeholder copy", () => {
    const onPix = vi.fn();
    render(
      <PaymentActions
        disabled={false}
        cardSelectable={true}
        pixSelectable={true}
        onCash={() => undefined}
        onCard={() => undefined}
        onPix={onPix}
      />
    );

    const pix = screen.getByTestId("checkout-pix");
    expect(pix).toBeEnabled();
    expect(pix).not.toHaveTextContent("em breve");
    expect(pix).toHaveAttribute("aria-label", "PIX");
    pix.click();
    expect(onPix).toHaveBeenCalledTimes(1);
  });
});

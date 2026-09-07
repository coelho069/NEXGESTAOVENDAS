import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PaymentActions } from "@/components/pdv/sale-summary";
import { getPaymentAdapter } from "@/lib/adapters/payment";
import {
  fetchCardPaymentSelectable,
  isCardPaymentHealthSelectable,
  isCheckoutPaymentSelectable,
} from "@/lib/adapters/payment-health";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

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

  it("keeps cash selectable and electronic methods not_configured without health", async () => {
    expect(getPaymentAdapter("card").process("0.00").status).toBe("not_configured");
    expect(getPaymentAdapter("pix").process("0.00").status).toBe("not_configured");
    await expect(isCheckoutPaymentSelectable("cash")).resolves.toBe(true);
    await expect(isCheckoutPaymentSelectable("pix")).resolves.toBe(false);
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
  it("disables card and keeps cash available when health is unknown", () => {
    const onCard = vi.fn();
    render(
      <PaymentActions disabled={false} cardSelectable={false} onCash={() => undefined} onCard={onCard} />
    );

    const card = screen.getByTestId("checkout-card");
    const cash = screen.getByTestId("checkout-cash");
    expect(card).toBeDisabled();
    expect(cash).toBeEnabled();
    expect(card).toHaveTextContent("não configurado");
    card.click();
    expect(onCard).not.toHaveBeenCalled();
  });
});

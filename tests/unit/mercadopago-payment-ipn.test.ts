import { describe, expect, it } from "vitest";
import {
  buildMercadoPagoNotificationUrl,
  isMercadoPagoRootPaymentIpn,
  parseMercadoPagoPaymentIpn,
} from "@/lib/domain/mercadopago-payment-ipn";

describe("Mercado Pago payment IPN", () => {
  it("builds the notification URL on the app origin", () => {
    expect(buildMercadoPagoNotificationUrl("https://nexgestaovendas.com.br/")).toBe(
      "https://nexgestaovendas.com.br/api/subscriptions/mercadopago/public-checkout/ipn"
    );
  });

  it("accepts a numeric payment topic and ignores anything else", () => {
    expect(parseMercadoPagoPaymentIpn("payment", "181527634585")).toEqual({
      id: "181527634585",
      type: "payment",
      action: "payment.updated",
      data: { id: "181527634585" },
    });
    expect(parseMercadoPagoPaymentIpn("merchant_order", "181527634585")).toBeNull();
    expect(parseMercadoPagoPaymentIpn("payment", "abc")).toBeNull();
    expect(parseMercadoPagoPaymentIpn("payment", "12")).toBeNull();
  });

  it("recognizes only the root POST used by the legacy feed", () => {
    expect(
      isMercadoPagoRootPaymentIpn({
        method: "POST",
        pathname: "/",
        topic: "payment",
        id: "182542681050",
      })
    ).toBe(true);
    expect(
      isMercadoPagoRootPaymentIpn({
        method: "GET",
        pathname: "/",
        topic: "payment",
        id: "182542681050",
      })
    ).toBe(false);
    expect(
      isMercadoPagoRootPaymentIpn({
        method: "POST",
        pathname: "/planos",
        topic: "payment",
        id: "182542681050",
      })
    ).toBe(false);
  });
});

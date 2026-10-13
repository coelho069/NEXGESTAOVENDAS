import { describe, expect, it } from "vitest";
import { normalizeAcceptedPaymentMethods } from "@/lib/domain/store-payment-methods";
import { getPaymentAdapter } from "@/lib/adapters/payment";
import { isDirectCheckoutPaymentMethod } from "@/lib/validation/schemas";

describe("store manual payment methods", () => {
  it("defaults to all four when unset or empty", () => {
    expect(normalizeAcceptedPaymentMethods(undefined)).toEqual(["cash", "pix_manual", "debito_manual", "credito_manual"]);
    expect(normalizeAcceptedPaymentMethods([])).toEqual(["cash", "pix_manual", "debito_manual", "credito_manual"]);
  });
  it("keeps fixed order and drops unknown values", () => {
    expect(normalizeAcceptedPaymentMethods(["credito_manual", "card", "cash", "cash"])).toEqual(["cash", "credito_manual"]);
  });
  it("manual card is a direct checkout method with no online charge", () => {
    expect(isDirectCheckoutPaymentMethod("debito_manual")).toBe(true);
    expect(isDirectCheckoutPaymentMethod("credito_manual")).toBe(true);
    expect(getPaymentAdapter("debito_manual").process("1.00").status).toBe("configured");
    expect(getPaymentAdapter("credito_manual").method).toBe("credito_manual");
  });
});

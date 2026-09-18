import { describe, expect, it, vi } from "vitest";
import { getPaymentAdapter } from "@/lib/adapters/payment";
import { isCheckoutPaymentSelectable } from "@/lib/adapters/payment-health";
import { buildProcessSalePayload } from "@/lib/domain/sale";
import type { CartLine } from "@/lib/domain/sale";
import { paymentMethodLabel } from "@/lib/domain/sale-history";
import { processSaleInputSchema } from "@/lib/validation/schemas";

const sampleLines: CartLine[] = [
  {
    productId: "44444444-4444-4444-8444-444444444401",
    sku: "BEV-001",
    name: "Agua Mineral 500ml",
    unitPrice: "3.50",
    quantity: 2,
    discount: "0.00",
  },
];

describe("pix_manual direct checkout", () => {
  it("adapter is configured and does not call Mercado Pago", () => {
    const adapter = getPaymentAdapter("pix_manual");
    expect(adapter.process("7.00")).toEqual({
      status: "configured",
      message: "PIX próprio registrado.",
    });
    expect(adapter.authorize("7.00")).toEqual({
      status: "captured",
      message: "PIX próprio confirmado no servidor.",
    });
    expect(adapter.process("7.00").message).not.toMatch(/mercado pago/i);
  });

  it("is selectable at checkout like cash", async () => {
    await expect(isCheckoutPaymentSelectable("pix_manual")).resolves.toBe(true);
    await expect(isCheckoutPaymentSelectable("cash")).resolves.toBe(true);
  });

  it("builds process_sale payload without provider_ref", () => {
    const payload = buildProcessSalePayload(
      "22222222-2222-4222-8222-222222222201",
      "99999999-9999-4999-8999-999999999999",
      sampleLines,
      "pix_manual",
      { discount: "0.00" }
    );

    expect(payload.payments).toEqual([{ method: "pix_manual", amount: "7.00" }]);
    expect(processSaleInputSchema.safeParse(payload).success).toBe(true);
  });

  it("keeps provider pix fail-closed at checkout health", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: { get: () => "application/json" },
      json: async () => ({ configured: false }),
    });
    await expect(isCheckoutPaymentSelectable("pix", fetchMock)).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledWith("/api/payments/pix", expect.any(Object));
  });

  it("labels pix_manual separately from provider pix", () => {
    expect(paymentMethodLabel("pix_manual")).toBe("PIX próprio");
    expect(paymentMethodLabel("pix")).toBe("PIX");
  });
});

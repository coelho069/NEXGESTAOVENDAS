import { describe, expect, it } from "vitest";
import { buildProcessSalePayload, cartSubtotal, cartTotal, lineTotal } from "@/lib/domain/sale";
import type { CartLine } from "@/lib/domain/sale";
import { formatBRL, multiplyMoney, sumMoney } from "@/lib/money";
import { getPaymentAdapter } from "@/lib/adapters/payment";
import { fiscalAdapter } from "@/lib/adapters/fiscal";
import { searchProducts } from "@/lib/domain/product";
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

describe("money", () => {
  it("formats BRL without float drift", () => {
    expect(sumMoney(["0.10", "0.20"])).toBe("0.30");
    expect(multiplyMoney("3.50", 2)).toBe("7.00");
    expect(formatBRL("7.00")).toContain("7,00");
  });
});

describe("sale domain", () => {
  it("computes line and cart totals", () => {
    expect(lineTotal(sampleLines[0])).toBe("7.00");
    expect(cartSubtotal(sampleLines)).toBe("7.00");
    expect(cartTotal(sampleLines, "1.00")).toBe("6.00");
  });

  it("builds process sale payload for cash", () => {
    const payload = buildProcessSalePayload(
      "22222222-2222-4222-8222-222222222201",
      "99999999-9999-4999-8999-999999999999",
      sampleLines,
      "cash",
      { discount: "0.00", saleId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
    );

    expect(payload.sale_id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(payload.payments).toEqual([{ method: "cash", amount: "7.00" }]);
    expect(payload.items[0].unit_price).toBe("3.50");
  });

  it("enforces one cash payment and exact numeric boundaries at the API schema", () => {
    const payload = buildProcessSalePayload(
      "22222222-2222-4222-8222-222222222201",
      "99999999-9999-4999-8999-999999999999",
      sampleLines,
      "cash",
      { discount: "0.00" }
    );

    expect(processSaleInputSchema.safeParse(payload).success).toBe(true);
    expect(
      processSaleInputSchema.safeParse({
        ...payload,
        payments: [payload.payments[0], payload.payments[0]],
      }).success
    ).toBe(false);
    expect(
      processSaleInputSchema.safeParse({
        ...payload,
        items: [{ ...payload.items[0], quantity: 1.0001 }],
      }).success
    ).toBe(false);
    expect(
      processSaleInputSchema.safeParse({
        ...payload,
        items: [{ ...payload.items[0], unit_price: "10000000000.00" }],
      }).success
    ).toBe(false);
  });
});

describe("adapters", () => {
  it("marks card/pix as not configured", () => {
    expect(getPaymentAdapter("card").process("10.00").status).toBe("not_configured");
    expect(getPaymentAdapter("pix").process("10.00").status).toBe("not_configured");
  });

  it("marks fiscal adapter as not configured", () => {
    expect(fiscalAdapter.issue("sale-id").status).toBe("not_configured");
  });
});

describe("product domain", () => {
  it("filters products by query", () => {
    const products = [
      {
        id: "1",
        sku: "BEV-001",
        name: "Agua Mineral 500ml",
        unit_price: 3.5,
        barcode: "789",
        category_id: null,
        is_active: true,
      },
    ];
    expect(searchProducts(products, "agua")).toHaveLength(1);
    expect(searchProducts(products, "padaria")).toHaveLength(0);
  });
});

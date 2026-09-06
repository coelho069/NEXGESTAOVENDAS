import { describe, expect, it } from "vitest";
import { resolveCashTender, suggestCashTenders } from "@/lib/domain/cash-tender";
import {
  buildLocalSaleHistoryList,
  paymentMethodLabel,
  saleStatusLabel,
} from "@/lib/domain/sale-history";
import { renderReceiptHtml, type ReceiptModel } from "@/lib/domain/receipt";
import type { LocalPayment, LocalSale } from "@/lib/offline/types";

describe("cash tender / troco", () => {
  it("calculates change without altering the sale total", () => {
    const result = resolveCashTender("12.50", "20.00");
    expect(result).toEqual({
      ok: true,
      amountReceived: "20.00",
      changeDue: "7.50",
    });
  });

  it("rejects insufficient tender", () => {
    const result = resolveCashTender("12.50", "10.00");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/insuficiente/i);
    }
  });

  it("suggests exact and rounded tenders", () => {
    expect(suggestCashTenders("12.50")).toEqual(["12.50", "20.00", "50.00", "100.00"]);
  });
});

describe("sale history local projection", () => {
  it("lists local sales newest first with payment method", () => {
    const sales: LocalSale[] = [
      {
        id: "sale-1",
        storeId: "store-1",
        clientMutationId: "mut-1",
        status: "pending_sync",
        syncStatus: "pending",
        subtotal: "10.00",
        discount: "0.00",
        total: "10.00",
        createdAt: "2026-09-05T10:00:00.000Z",
      },
      {
        id: "sale-2",
        storeId: "store-1",
        clientMutationId: "mut-2",
        status: "confirmed",
        syncStatus: "synced",
        subtotal: "5.00",
        discount: "0.00",
        total: "5.00",
        createdAt: "2026-09-05T11:00:00.000Z",
      },
    ];
    const payments: LocalPayment[] = [
      {
        id: "pay-1",
        saleId: "sale-1",
        method: "cash",
        amount: "10.00",
        status: "pending",
      },
      {
        id: "pay-2",
        saleId: "sale-2",
        method: "cash",
        amount: "5.00",
        status: "captured",
      },
    ];

    const listed = buildLocalSaleHistoryList(sales, payments, { limit: 10 });
    expect(listed.rows.map((row) => row.sale_id)).toEqual(["sale-2", "sale-1"]);
    expect(listed.rows[0]?.payment_method).toBe("cash");
    expect(saleStatusLabel("confirmed")).toBe("Confirmada");
    expect(paymentMethodLabel("pix")).toBe("PIX");
  });
});

describe("receipt commercial fields", () => {
  it("renders operator, received amount and change", () => {
    const receipt: ReceiptModel = {
      saleId: "sale-abc",
      storeName: "Loja Centro",
      createdAt: "2026-09-05T12:00:00.000Z",
      customerName: "Maria",
      operatorName: "Caixa",
      lines: [
        {
          productId: "p1",
          sku: "BEV-001",
          name: "Agua",
          quantity: 1,
          unitPrice: "3.50",
          discount: "0.00",
        },
      ],
      subtotal: "3.50",
      discount: "0.00",
      total: "3.50",
      amountReceived: "10.00",
      changeDue: "6.50",
      payments: [{ method: "cash", amount: "3.50", status: "captured" }],
      syncStatus: "synced",
      saleStatus: "confirmed",
    };

    const html = renderReceiptHtml(receipt);
    expect(html).toContain("Operador: Caixa");
    expect(html).toContain('data-receipt-received');
    expect(html).toContain('data-receipt-change');
    expect(html).toContain("Troco");
  });
});

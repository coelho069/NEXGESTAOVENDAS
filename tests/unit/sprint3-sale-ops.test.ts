import { describe, expect, it } from "vitest";
import { toCatalogProduct, type CatalogProduct } from "@/lib/domain/catalog";
import { HidScanAssembler } from "@/lib/domain/hid-scanner";
import { matchPdvShortcut } from "@/lib/domain/pdv-shortcuts";
import { resolvePaymentAttempt } from "@/lib/domain/payment-attempt";
import { renderReceiptHtml } from "@/lib/domain/receipt";
import {
  addItem,
  applyDiscount,
  calculateTotals,
  emptySaleState,
  maxDiscountForRole,
  removeItem,
  setQuantity,
  validateSale,
  type SaleState,
} from "@/lib/domain/sale-ops";

const agua: CatalogProduct = toCatalogProduct({
  id: "44444444-4444-4444-8444-444444444401",
  sku: "BEV-001",
  name: "Agua Mineral 500ml",
  unit_price: 3.5,
  barcode: "7891000100011",
  category_id: null,
  is_active: true,
});

const refri: CatalogProduct = toCatalogProduct({
  id: "44444444-4444-4444-8444-444444444402",
  sku: "BEV-002",
  name: "Refrigerante Lata 350ml",
  unit_price: 5,
  barcode: "7891000100028",
  category_id: null,
  is_active: true,
});

const inactive: CatalogProduct = {
  ...agua,
  productId: "inactive-1",
  sku: "INA-001",
  name: "Produto Inativo",
  isActive: false,
};

function withAgua(qty = 1): SaleState {
  const added = addItem(emptySaleState(), agua, qty, { [agua.productId]: 120 });
  if (!added.ok) throw new Error(added.error);
  return added.state;
}

describe("addItem / removeItem / setQuantity", () => {
  it("adds and merges quantity without clearing other lines", () => {
    const first = addItem(emptySaleState(), agua, 1, { [agua.productId]: 10, [refri.productId]: 10 });
    expect(first.ok).toBe(true);
    const second = addItem(first.state, refri, 1, { [agua.productId]: 10, [refri.productId]: 10 });
    expect(second.ok).toBe(true);
    const third = addItem(second.state, agua, 2, { [agua.productId]: 10, [refri.productId]: 10 });
    expect(third.ok).toBe(true);
    expect(third.state.lines).toHaveLength(2);
    expect(third.state.lines.find((line) => line.sku === "BEV-001")?.quantity).toBe(3);
    expect(third.state.lines.find((line) => line.sku === "BEV-002")?.quantity).toBe(1);
  });

  it("blocks inactive products and insufficient stock", () => {
    expect(addItem(emptySaleState(), inactive, 1, { [inactive.productId]: 10 }).ok).toBe(false);
    const full = addItem(emptySaleState(), agua, 1, { [agua.productId]: 1 });
    expect(full.ok).toBe(true);
    const overflow = addItem(full.state, agua, 1, { [agua.productId]: 1 });
    expect(overflow.ok).toBe(false);
    expect(overflow.state.lines).toHaveLength(1);
    expect(overflow.state.lines[0]?.quantity).toBe(1);
  });

  it("setQuantity removes at zero and removeItem drops the line", () => {
    const state = withAgua(2);
    const zero = setQuantity(state, agua.productId, 0, { [agua.productId]: 10 });
    expect(zero.ok).toBe(true);
    expect(zero.state.lines).toHaveLength(0);
    const removed = removeItem(withAgua(1), agua.productId);
    expect(removed.state.lines).toHaveLength(0);
  });
});

describe("applyDiscount / calculateTotals / validateSale", () => {
  it("calculates totals with decimal money strings", () => {
    const totals = calculateTotals(withAgua(2));
    expect(totals.subtotal).toBe("7.00");
    expect(totals.total).toBe("7.00");
    expect(totals.discount).toBe("0.00");
  });

  it("enforces cashier vs manager discount limits", () => {
    const state = withAgua(2);
    expect(maxDiscountForRole("7.00", "cashier")).toBe("0.35");
    expect(maxDiscountForRole("7.00", "manager")).toBe("1.40");
    expect(applyDiscount(state, "0.30", "cashier").ok).toBe(true);
    expect(applyDiscount(state, "1.00", "cashier").ok).toBe(false);
    expect(applyDiscount(state, "1.00", "manager").ok).toBe(true);
    expect(applyDiscount(state, "8.00", "admin").ok).toBe(false);
  });

  it("validateSale rejects empty cart, inactive and negative stock", () => {
    expect(validateSale(emptySaleState(), { role: "cashier" }).ok).toBe(false);
    const invalid = validateSale(withAgua(5), { role: "cashier", stock: { [agua.productId]: 2 } });
    expect(invalid.ok).toBe(false);
    const withInactiveLine: SaleState = {
      ...withAgua(1),
      lines: [{ ...withAgua(1).lines[0]!, productId: inactive.productId, name: inactive.name }],
    };
    expect(
      validateSale(withInactiveLine, {
        role: "cashier",
        products: [inactive],
        stock: { [inactive.productId]: 10 },
      }).ok
    ).toBe(false);
  });
});

describe("HID scanner assembler", () => {
  it("detects rapid barcode + Enter and ignores slow typing", () => {
    const scanner = new HidScanAssembler();
    let now = 1_000;
    for (const char of "7891000100011") {
      expect(scanner.push(char, now).type).toBe("none");
      now += 12;
    }
    expect(scanner.push("Enter", now).type).toBe("scan");

    const slow = new HidScanAssembler();
    now = 2_000;
    for (const char of "BEV-001") {
      slow.push(char, now);
      now += 120;
    }
    expect(slow.push("Enter", now)).toEqual({ type: "none" });
  });
});

describe("payment draft and receipt", () => {
  it("keeps draft when adapter is not configured", () => {
    expect(resolvePaymentAttempt({ status: "configured", message: "ok" })).toEqual({ kind: "capture" });
    expect(resolvePaymentAttempt({ status: "not_configured", message: "Adapter card não configurado no Sprint 1." })).toEqual({
      kind: "keep_draft",
      message: "Adapter card não configurado no Sprint 1.",
    });
  });

  it("renders HTML receipt with sync status", () => {
    const html = renderReceiptHtml({
      saleId: "sale-1",
      storeName: "Loja Centro",
      createdAt: "2026-09-01T15:00:00.000Z",
      customerName: "Maria Silva",
      lines: withAgua(2).lines,
      subtotal: "7.00",
      discount: "0.30",
      total: "6.70",
      payments: [{ method: "cash", amount: "6.70", status: "captured" }],
      syncStatus: "pending",
      saleStatus: "pending_sync",
    });
    expect(html).toContain("Sincronização: pending");
    expect(html).toContain("data-receipt-sync=\"pending\"");
    expect(html).toContain("Maria Silva");
  });
});

describe("keyboard shortcuts", () => {
  it("maps F2 F4 F6 F8 F9 Esc Ctrl+K and +/-", () => {
    expect(matchPdvShortcut({ key: "F2", ctrlKey: false, metaKey: false, altKey: false })).toBe("search");
    expect(matchPdvShortcut({ key: "k", ctrlKey: true, metaKey: false, altKey: false })).toBe("search");
    expect(matchPdvShortcut({ key: "F4", ctrlKey: false, metaKey: false, altKey: false })).toBe("customer");
    expect(matchPdvShortcut({ key: "F6", ctrlKey: false, metaKey: false, altKey: false })).toBe("discount");
    expect(matchPdvShortcut({ key: "F8", ctrlKey: false, metaKey: false, altKey: false })).toBe("payment");
    expect(matchPdvShortcut({ key: "F9", ctrlKey: false, metaKey: false, altKey: false })).toBe("receipt");
    expect(matchPdvShortcut({ key: "Escape", ctrlKey: false, metaKey: false, altKey: false })).toBe("cancel");
    expect(matchPdvShortcut({ key: "+", ctrlKey: false, metaKey: false, altKey: false })).toBe("qtyInc");
    expect(matchPdvShortcut({ key: "-", ctrlKey: false, metaKey: false, altKey: false })).toBe("qtyDec");
  });
});
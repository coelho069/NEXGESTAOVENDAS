import { describe, expect, it } from "vitest";
import { DEMO_PRODUCTS, toCatalogProduct } from "@/lib/domain/catalog";
import { resolveCatalogLoad } from "@/lib/domain/catalog-load";
import { unifyCheckoutPayment } from "@/lib/domain/payment-attempt";
import {
  isEditableTarget,
  isPdvSearchTarget,
  matchPdvShortcut,
  shouldAcceptHidScan,
  shouldHandleShortcut,
} from "@/lib/domain/pdv-shortcuts";
import { resolveReceiptSyncState } from "@/lib/domain/receipt-sync";
import {
  addItem,
  discountLimitHttpStatus,
  emptySaleState,
  isLocalStockEmpty,
  salePayloadExceedsDiscountCap,
  validateSaleAmounts,
  validateSale,
} from "@/lib/domain/sale-ops";
import { createPdvLocalDb, deletePdvLocalDb } from "@/lib/offline/pdv-local-db";
import { ensureLocalInventory } from "@/lib/offline/seed-local-inventory";
import { writeFixtureInventory } from "@/lib/pdv/fixtures";

const agua = toCatalogProduct({
  id: "44444444-4444-4444-8444-444444444401",
  sku: "BEV-001",
  name: "Agua Mineral 500ml",
  unit_price: 3.5,
  barcode: "7891000100011",
  category_id: null,
  is_active: true,
});

function searchInput(): HTMLInputElement {
  const input = document.createElement("input");
  input.id = "pdv-search-input";
  input.setAttribute("data-testid", "pdv-search-input");
  return input;
}

describe("1. receipt sync considers outbox and pendingCount", () => {
  it("never marks synced when pendingCount is zero but outbox is conflict or failed", () => {
    expect(
      resolveReceiptSyncState({
        pendingCount: 0,
        online: true,
        outboxStatus: "conflict",
        conflictForSale: true,
      })
    ).toEqual({ syncStatus: "conflict", saleStatus: "pending_sync" });

    expect(
      resolveReceiptSyncState({
        pendingCount: 0,
        online: true,
        outboxStatus: "failed",
      })
    ).toEqual({ syncStatus: "failed", saleStatus: "pending_sync" });

    expect(
      resolveReceiptSyncState({
        pendingCount: 2,
        online: true,
        outboxStatus: "pending",
      })
    ).toEqual({ syncStatus: "pending", saleStatus: "pending_sync" });

    expect(
      resolveReceiptSyncState({
        pendingCount: 0,
        online: true,
        outboxStatus: "synced",
      })
    ).toEqual({ syncStatus: "synced", saleStatus: "confirmed" });

    expect(
      resolveReceiptSyncState({
        pendingCount: 3,
        online: false,
        outboxStatus: "synced",
      })
    ).toEqual({ syncStatus: "synced", saleStatus: "confirmed" });
  });
});

describe("2. demo stock seeding removed; empty stock blocks sale", () => {
  it("ensureLocalInventory does not insert demo balances", async () => {
    const db = createPdvLocalDb(`pdv_local_v1_${crypto.randomUUID()}`);
    await db.open();
    await ensureLocalInventory(db, "22222222-2222-4222-8222-222222222201");
    expect(await db.inventoryBalances.count()).toBe(0);
    db.close();
    await deletePdvLocalDb(db.name);
  });

  it("fixture inventory does not reset a projected balance after a sale", async () => {
    const storeId = "22222222-2222-4222-8222-222222222201";
    const product = DEMO_PRODUCTS[0]!;
    const db = createPdvLocalDb(`pdv_local_v1_${crypto.randomUUID()}`);
    await db.open();
    const initial = await writeFixtureInventory(db, storeId);
    await db.inventoryBalances.put({
      storeId,
      productId: product.id,
      quantity: initial[product.id]! - 1,
      serverQuantity: initial[product.id]!,
      updatedAt: new Date().toISOString(),
    });

    const preserved = await writeFixtureInventory(db, storeId);
    expect(preserved[product.id]).toBe(initial[product.id]! - 1);
    db.close();
    await deletePdvLocalDb(db.name);
  });

  it("empty stock map fails addItem and validateSale", () => {
    expect(isLocalStockEmpty({})).toBe(true);
    expect(addItem(emptySaleState(), agua, 1, {}).ok).toBe(false);
    expect(addItem(emptySaleState(), agua, 1, {}).error).toMatch(/vazio/i);
    const withLine = addItem(emptySaleState(), agua, 1, { [agua.productId]: 5 });
    expect(withLine.ok).toBe(true);
    expect(validateSale(withLine.state, { role: "cashier", stock: {} }).ok).toBe(false);
  });
});

describe("3. DEMO_PRODUCTS not used on catalog failure", () => {
  it("returns empty list and error when fetch fails without fixtures", () => {
    const resolved = resolveCatalogLoad({
      failed: true,
      data: null,
      fixtures: false,
      fixtureProducts: DEMO_PRODUCTS,
    });
    expect(resolved.products).toEqual([]);
    expect(resolved.error).toMatch(/catálogo/i);
  });
});

describe("4. server discount cap returns 403", () => {
  const items = [{ quantity: 2, unit_price: "3.50", discount: "0.00" }];

  it("cashier over 5% is forbidden; manager within 20% is allowed", () => {
    expect(salePayloadExceedsDiscountCap({ discount: "1.00", items }, "cashier")).toBe(true);
    expect(salePayloadExceedsDiscountCap({ discount: "0.30", items }, "cashier")).toBe(false);
    expect(salePayloadExceedsDiscountCap({ discount: "1.00", items }, "manager")).toBe(false);
    expect(
      salePayloadExceedsDiscountCap(
        { discount: "0.00", items: [{ quantity: 2, unit_price: "3.50", discount: "0.36" }] },
        "cashier"
      )
    ).toBe(true);
    expect(discountLimitHttpStatus(true)).toBe(403);
    expect(discountLimitHttpStatus(false)).toBe(200);
  });
});

describe("5. closeSale and receipt share payment method", () => {
  it("unifyCheckoutPayment is the single method/amount pair", () => {
    const payment = unifyCheckoutPayment("cash", "6.70");
    expect(payment).toEqual({ method: "cash", amount: "6.70" });
    const closeSalePayload = { payments: [payment] };
    const receiptPayments = [{ ...payment, status: "captured" }];
    expect(closeSalePayload.payments[0]?.method).toBe(receiptPayments[0]?.method);
    expect(closeSalePayload.payments[0]?.amount).toBe(receiptPayments[0]?.amount);
  });
});

describe("6. sale amount boundary", () => {
  it("rejects tampered money, duplicate products and unsupported quantity precision", () => {
    const valid = emptySaleState();
    const added = addItem(valid, agua, 1, { [agua.productId]: 10 });
    if (!added.ok) throw new Error(added.error);

    expect(
      validateSaleAmounts(
        {
          ...added.state,
          lines: [{ ...added.state.lines[0]!, discount: "10.00" }],
        },
        "admin"
      )
    ).toMatch(/desconto do item/i);

    expect(
      validateSaleAmounts(
        {
          ...added.state,
          lines: [...added.state.lines, { ...added.state.lines[0]! }],
        },
        "admin"
      )
    ).toMatch(/duplicado/i);

    expect(
      validateSaleAmounts(
        {
          ...added.state,
          lines: [{ ...added.state.lines[0]!, quantity: 1.2345 }],
        },
        "admin"
      )
    ).toMatch(/quantidade inválida/i);
  });
});

describe("7. HID and shortcuts respect modal and input focus except search", () => {
  it("blocks HID in discount input and when a modal is open; allows search field", () => {
    const discount = document.createElement("input");
    expect(isEditableTarget(discount)).toBe(true);
    expect(shouldAcceptHidScan(discount, false)).toBe(false);
    expect(shouldAcceptHidScan(searchInput(), false)).toBe(true);
    expect(shouldAcceptHidScan(document.body, true)).toBe(false);
    expect(shouldAcceptHidScan(document.body, false)).toBe(true);
  });

  it("does not fire F6 inside inputs; search shortcut still works", () => {
    const discount = document.createElement("input");
    expect(shouldHandleShortcut("discount", discount)).toBe(false);
    expect(shouldHandleShortcut("search", discount)).toBe(true);
    expect(shouldHandleShortcut("cancel", discount)).toBe(true);
    expect(isPdvSearchTarget(searchInput())).toBe(true);
    expect(shouldHandleShortcut("discount", searchInput())).toBe(false);
    expect(shouldHandleShortcut("discount", document.body, true)).toBe(false);
    expect(shouldHandleShortcut("cancel", document.body, true)).toBe(true);
    expect(matchPdvShortcut({ key: "F6", ctrlKey: false, metaKey: false, altKey: false })).toBe("discount");
  });
});

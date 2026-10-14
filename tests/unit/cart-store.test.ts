import { describe, expect, it } from "vitest";
import { createCartStore } from "@/stores/cart-store";

const STORE_A = "22222222-2222-4222-8222-222222222201";
const STORE_B = "22222222-2222-4222-8222-222222222202";

const line = {
  productId: "44444444-4444-4444-8444-444444444401",
  sku: "BEV-001",
  name: "Agua Mineral 500ml",
  unitPrice: "3.50",
  quantity: 1,
  discount: "0.00",
};

describe("cart store context", () => {
  it("rejects a store change while the cart has lines", () => {
    const store = createCartStore({ persist: false });
    store.getState().setStoreId(STORE_A);
    store.getState().addLine(line);

    expect(store.getState().setStoreId(STORE_B)).toBe(false);
    expect(store.getState().storeId).toBe(STORE_A);
    expect(store.getState().lines).toEqual([line]);
  });

  it("rejects a store change while checkout is pending or in flight", () => {
    const store = createCartStore({ persist: false });
    store.getState().setStoreId(STORE_A);
    store.getState().setCheckoutAttemptId("55555555-5555-4555-8555-555555555555");
    expect(store.getState().setStoreId(STORE_B)).toBe(false);

    store.getState().setCheckoutAttemptId(null);
    store.getState().setCheckoutInFlight(true);
    expect(store.getState().setStoreId(STORE_B)).toBe(false);
  });

  it("discards a foreign store cart even when it still has lines", () => {
    const store = createCartStore({ persist: false });
    store.getState().setStoreId(STORE_A);
    store.getState().addLine(line);
    store.getState().setDiscount("1.50");
    store.getState().setCustomer("66666666-6666-4666-8666-666666666666", "Ana");
    store.getState().setSuspendedContext({
      suspendedSaleId: "77777777-7777-4777-8777-777777777777",
      claimId: "88888888-8888-4888-8888-888888888888",
    });
    store.getState().setCheckoutAttemptId("55555555-5555-4555-8555-555555555555");
    store.getState().setCheckoutInFlight(true);

    store.getState().discardForeignStore();

    expect(store.getState().storeId).toBeNull();
    expect(store.getState().lines).toEqual([]);
    expect(store.getState().discount).toBe("0.00");
    expect(store.getState().customerId).toBeNull();
    expect(store.getState().customerName).toBeNull();
    expect(store.getState().suspendedSaleId).toBeNull();
    expect(store.getState().suspensionClaimId).toBeNull();
    expect(store.getState().checkoutAttemptId).toBeNull();
    expect(store.getState().checkoutInFlight).toBe(false);
    expect(store.getState().setStoreId(STORE_B)).toBe(true);
  });

  it("allows a new store after the cart is cleared", () => {
    const store = createCartStore({ persist: false });
    store.getState().setStoreId(STORE_A);
    store.getState().addLine(line);
    store.getState().clear();

    expect(store.getState().setStoreId(STORE_B)).toBe(true);
    expect(store.getState().storeId).toBe(STORE_B);
    expect(store.getState().lines).toEqual([]);
  });
});

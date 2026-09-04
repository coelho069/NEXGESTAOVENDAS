"use client";

import { create, type StateCreator, type StoreApi, type UseBoundStore } from "zustand";
import { persist } from "zustand/middleware";
import type { CartLine } from "@/lib/domain/sale";
import { cartTotal } from "@/lib/domain/sale";
import { stripSecrets } from "@/lib/offline/secrets";

export const CART_PERSIST_KEY = "nex-pdv-cart";

export type CartState = {
  storeId: string | null;
  lines: CartLine[];
  discount: string;
  customerId: string | null;
  customerName: string | null;
  suspendedSaleId: string | null;
  suspensionClaimId: string | null;
  checkoutAttemptId: string | null;
  checkoutInFlight: boolean;
  setStoreId: (storeId: string | null) => boolean;
  setCheckoutAttemptId: (checkoutAttemptId: string | null) => void;
  setCheckoutInFlight: (checkoutInFlight: boolean) => void;
  addLine: (line: CartLine) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  removeLine: (productId: string) => void;
  setDiscount: (discount: string) => void;
  setLines: (lines: CartLine[]) => void;
  setCustomer: (customerId: string | null, customerName: string | null) => void;
  setSuspendedContext: (context: { suspendedSaleId: string; claimId: string } | null) => void;
  clear: () => void;
  total: () => string;
};

export type CartStore = UseBoundStore<StoreApi<CartState>>;

const createCartSlice: StateCreator<CartState> = (set, get) => ({
  storeId: null,
  lines: [],
  discount: "0.00",
  customerId: null,
  customerName: null,
  suspendedSaleId: null,
  suspensionClaimId: null,
  checkoutAttemptId: null,
  checkoutInFlight: false,
  setStoreId: (storeId) => {
    const current = get();
    if (current.storeId === storeId) return true;
    if (current.lines.length > 0 || current.checkoutAttemptId || current.checkoutInFlight) return false;
    set({ storeId });
    return true;
  },
  setCheckoutAttemptId: (checkoutAttemptId) => set({ checkoutAttemptId }),
  setCheckoutInFlight: (checkoutInFlight) => set({ checkoutInFlight }),
  addLine: (line) =>
    set((state) => {
      const existing = state.lines.find((item) => item.productId === line.productId);
      if (existing) {
        return {
          lines: state.lines.map((item) =>
            item.productId === line.productId
              ? { ...item, quantity: item.quantity + line.quantity }
              : item
          ),
        };
      }
      return { lines: [...state.lines, line] };
    }),
  updateQuantity: (productId, quantity) =>
    set((state) => ({
      lines: state.lines
        .map((item) => (item.productId === productId ? { ...item, quantity } : item))
        .filter((item) => item.quantity > 0),
    })),
  removeLine: (productId) =>
    set((state) => ({
      lines: state.lines.filter((item) => item.productId !== productId),
    })),
  setDiscount: (discount) => set({ discount }),
  setLines: (lines) => set({ lines }),
  setCustomer: (customerId, customerName) => set({ customerId, customerName }),
  setSuspendedContext: (context) =>
    set({
      suspendedSaleId: context?.suspendedSaleId ?? null,
      suspensionClaimId: context?.claimId ?? null,
    }),
  clear: () =>
    set({
      lines: [],
      discount: "0.00",
      customerId: null,
      customerName: null,
      suspendedSaleId: null,
      suspensionClaimId: null,
      checkoutAttemptId: null,
    }),
  total: () => cartTotal(get().lines, get().discount),
});

export function createCartStore(options?: { persist?: boolean }): CartStore {
  if (options?.persist === false) {
    return create<CartState>()(createCartSlice);
  }

  return create<CartState>()(
    persist(createCartSlice, {
      name: CART_PERSIST_KEY,
      partialize: (state) =>
        stripSecrets({
          storeId: state.storeId,
          lines: state.lines,
          discount: state.discount,
          customerId: state.customerId,
          customerName: state.customerName,
          suspendedSaleId: state.suspendedSaleId,
          suspensionClaimId: state.suspensionClaimId,
          checkoutAttemptId: state.checkoutAttemptId,
        }),
    })
  );
}

export const useCartStore = createCartStore({ persist: true });

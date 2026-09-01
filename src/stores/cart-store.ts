"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CartLine } from "@/lib/domain/sale";
import { cartTotal } from "@/lib/domain/sale";

type CartState = {
  storeId: string | null;
  lines: CartLine[];
  discount: string;
  setStoreId: (storeId: string) => void;
  addLine: (line: CartLine) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  removeLine: (productId: string) => void;
  setDiscount: (discount: string) => void;
  clear: () => void;
  total: () => string;
};

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      storeId: null,
      lines: [],
      discount: "0.00",
      setStoreId: (storeId) => set({ storeId }),
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
      clear: () => set({ lines: [], discount: "0.00" }),
      total: () => cartTotal(get().lines, get().discount),
    }),
    { name: "nex-pdv-cart" }
  )
);

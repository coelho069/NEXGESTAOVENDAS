"use client";

import { create } from "zustand";
import type { ReceiptModel } from "@/lib/domain/receipt";

export type PdvPanel = "none" | "payment" | "customer" | "discount" | "receipt";

export type PdvUiState = {
  selectedProductId: string | null;
  openPanel: PdvPanel;
  lastReceipt: ReceiptModel | null;
  draftReason: string | null;
  inventoryEpoch: number;
  setSelectedProductId: (productId: string | null) => void;
  setOpenPanel: (panel: PdvPanel) => void;
  setLastReceipt: (receipt: ReceiptModel | null) => void;
  setDraftReason: (reason: string | null) => void;
  bumpInventory: () => void;
};

export const usePdvUiStore = create<PdvUiState>((set) => ({
  selectedProductId: null,
  openPanel: "none",
  lastReceipt: null,
  draftReason: null,
  inventoryEpoch: 0,
  setSelectedProductId: (selectedProductId) => set({ selectedProductId }),
  setOpenPanel: (openPanel) => set({ openPanel }),
  setLastReceipt: (lastReceipt) => set({ lastReceipt }),
  setDraftReason: (draftReason) => set({ draftReason }),
  bumpInventory: () => set((state) => ({ inventoryEpoch: state.inventoryEpoch + 1 })),
}));
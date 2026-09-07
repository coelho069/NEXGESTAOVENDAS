"use client";

import { create } from "zustand";
import type { ReceiptModel } from "@/lib/domain/receipt";
import type { StripePixQr } from "@/lib/domain/stripe-pix";

export type PdvPanel = "none" | "payment" | "customer" | "discount" | "receipt" | "pix-qr";

export type PendingPixCheckout = {
  clientMutationId: string;
  providerReference: string;
  amount: string;
  qr: StripePixQr | null;
};

export type PdvUiState = {
  selectedProductId: string | null;
  openPanel: PdvPanel;
  lastReceipt: ReceiptModel | null;
  pendingPix: PendingPixCheckout | null;
  draftReason: string | null;
  inventoryEpoch: number;
  setSelectedProductId: (productId: string | null) => void;
  setOpenPanel: (panel: PdvPanel) => void;
  setLastReceipt: (receipt: ReceiptModel | null) => void;
  setPendingPix: (pending: PendingPixCheckout | null) => void;
  setDraftReason: (reason: string | null) => void;
  bumpInventory: () => void;
};

export const usePdvUiStore = create<PdvUiState>((set) => ({
  selectedProductId: null,
  openPanel: "none",
  lastReceipt: null,
  pendingPix: null,
  draftReason: null,
  inventoryEpoch: 0,
  setSelectedProductId: (selectedProductId) => set({ selectedProductId }),
  setOpenPanel: (openPanel) => set({ openPanel }),
  setLastReceipt: (lastReceipt) => set({ lastReceipt }),
  setPendingPix: (pendingPix) => set({ pendingPix }),
  setDraftReason: (draftReason) => set({ draftReason }),
  bumpInventory: () => set((state) => ({ inventoryEpoch: state.inventoryEpoch + 1 })),
}));
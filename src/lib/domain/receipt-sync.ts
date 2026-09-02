import type { Enums } from "@/lib/db/types";

export type ReceiptSyncInput = {
  pendingCount: number;
  online: boolean;
  outboxStatus?: Enums<"sync_status"> | null;
  conflictForSale?: boolean;
};

export type ReceiptSyncResult = {
  syncStatus: string;
  saleStatus: string;
};

export function resolveReceiptSyncState(input: ReceiptSyncInput): ReceiptSyncResult {
  const status = input.outboxStatus ?? null;
  if (input.conflictForSale || status === "conflict") {
    return { syncStatus: "conflict", saleStatus: "pending_sync" };
  }
  if (status === "failed") {
    return { syncStatus: "failed", saleStatus: "pending_sync" };
  }
  if (status === "synced") {
    return { syncStatus: "synced", saleStatus: "confirmed" };
  }
  if (status === "pending" || status === "processing") {
    return { syncStatus: "pending", saleStatus: "pending_sync" };
  }
  if (input.pendingCount > 0 || !input.online) {
    return { syncStatus: "pending", saleStatus: "pending_sync" };
  }
  return { syncStatus: "pending", saleStatus: "pending_sync" };
}

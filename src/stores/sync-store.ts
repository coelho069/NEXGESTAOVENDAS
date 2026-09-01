"use client";

import { create } from "zustand";
import type { Enums } from "@/lib/db/types";

type SyncState = {
  online: boolean;
  syncing: boolean;
  lastSyncAt: string | null;
  pendingCount: number;
  setOnline: (online: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setPendingCount: (count: number) => void;
  markSynced: () => void;
};

export const useSyncStore = create<SyncState>((set) => ({
  online: typeof navigator !== "undefined" ? navigator.onLine : true,
  syncing: false,
  lastSyncAt: null,
  pendingCount: 0,
  setOnline: (online) => set({ online }),
  setSyncing: (syncing) => set({ syncing }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  markSynced: () =>
    set({
      lastSyncAt: new Date().toISOString(),
      syncing: false,
    }),
}));

export type SyncBadgeStatus = Enums<"sync_status"> | "offline";

export function resolveSyncBadge(online: boolean, pendingCount: number): SyncBadgeStatus {
  if (!online) return "offline";
  if (pendingCount > 0) return "pending";
  return "synced";
}

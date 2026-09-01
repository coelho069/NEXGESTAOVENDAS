"use client";

import { create } from "zustand";
import type { Enums } from "@/lib/db/types";
import type { LocalConflict } from "@/lib/offline/types";

type SyncState = {
  online: boolean;
  syncing: boolean;
  lastSyncAt: string | null;
  pendingCount: number;
  conflicts: LocalConflict[];
  quotaExceeded: boolean;
  sessionEnded: boolean;
  lastHeartbeatAt: string | null;
  setOnline: (online: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setPendingCount: (count: number) => void;
  setConflicts: (conflicts: LocalConflict[]) => void;
  setQuotaExceeded: (quotaExceeded: boolean) => void;
  setSessionEnded: (sessionEnded: boolean) => void;
  setLastHeartbeatAt: (at: string | null) => void;
  markSynced: () => void;
};

export const useSyncStore = create<SyncState>((set) => ({
  online: typeof navigator !== "undefined" ? navigator.onLine : true,
  syncing: false,
  lastSyncAt: null,
  pendingCount: 0,
  conflicts: [],
  quotaExceeded: false,
  sessionEnded: false,
  lastHeartbeatAt: null,
  setOnline: (online) => set({ online }),
  setSyncing: (syncing) => set({ syncing }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setConflicts: (conflicts) => set({ conflicts }),
  setQuotaExceeded: (quotaExceeded) => set({ quotaExceeded }),
  setSessionEnded: (sessionEnded) => set({ sessionEnded }),
  setLastHeartbeatAt: (lastHeartbeatAt) => set({ lastHeartbeatAt }),
  markSynced: () =>
    set({
      lastSyncAt: new Date().toISOString(),
      syncing: false,
    }),
}));

export type SyncBadgeStatus = Enums<"sync_status"> | "offline";

export function resolveSyncBadge(
  online: boolean,
  pendingCount: number,
  options?: { conflictCount?: number; failed?: boolean }
): SyncBadgeStatus {
  if (!online) return "offline";
  if ((options?.conflictCount ?? 0) > 0) return "conflict";
  if (options?.failed) return "failed";
  if (pendingCount > 0) return "pending";
  return "synced";
}

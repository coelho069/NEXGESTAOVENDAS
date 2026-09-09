"use client";

import { useEffect } from "react";
import { startHeartbeat } from "@/lib/offline/heartbeat";
import { getPdvLocalDbForUser } from "@/lib/offline/pdv-local-db";
import { useAuth } from "@/hooks/use-auth";
import { useCheckout } from "@/hooks/use-checkout";
import { useSyncStore } from "@/stores/sync-store";

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { setOnline, setLastHeartbeatAt } = useSyncStore();
  const { flushPending, refreshSyncUi } = useCheckout();

  useEffect(() => {
    if (loading) return;

    const db = getPdvLocalDbForUser(user?.id);
    void refreshSyncUi();

    const stopHeartbeat = startHeartbeat({
      intervalMs: 15_000,
      onBeat: async (info) => {
        setOnline(info.online);
        setLastHeartbeatAt(info.at);
        await db.meta.put({ key: "heartbeat.at", value: info.at });
        await db.meta.put({ key: "heartbeat.tabId", value: info.tabId });
      },
    });

    const handleOnline = () => {
      setOnline(true);
      void flushPending();
    };
    const handleOffline = () => setOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const syncTimer = window.setInterval(() => {
      if (navigator.onLine) void flushPending();
    }, 10_000);

    const onWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === "FLUSH_PENDING_SALES") {
        void flushPending();
      }
    };
    navigator.serviceWorker?.addEventListener("message", onWorkerMessage);

    return () => {
      stopHeartbeat();
      window.clearInterval(syncTimer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      navigator.serviceWorker?.removeEventListener("message", onWorkerMessage);
    };
  }, [flushPending, loading, refreshSyncUi, setLastHeartbeatAt, setOnline, user?.id]);

  return <>{children}</>;
}

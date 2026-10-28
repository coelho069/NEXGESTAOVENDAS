"use client";

import { useEffect } from "react";
import { startHeartbeat } from "@/lib/offline/heartbeat";
import { runWhenIdle } from "@/lib/offline/run-when-idle";
import { getSessionPdvLocalDb } from "@/lib/offline/session-pdv-db";
import { useAuth } from "@/hooks/use-auth";
import { useCheckout } from "@/hooks/use-checkout";
import { useCartStore } from "@/stores/cart-store";
import { useSessionStore } from "@/stores/session-store";
import { useSyncStore } from "@/stores/sync-store";

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { loading } = useAuth();
  const userId = useSessionStore((state) => state.userId);
  const storeId = useCartStore((state) => state.storeId);
  const { setOnline, setLastHeartbeatAt } = useSyncStore();
  const { flushPending, refreshSyncUi } = useCheckout();

  useEffect(() => {
    if (loading || !userId) return;

    const db = getSessionPdvLocalDb();
    let stopHeartbeat: () => void = () => undefined;
    let syncTimer: number | undefined;

    // Trabalho de sync inicial (UI, flush, heartbeat, timer) vai para depois do primeiro paint,
    // para não disputar requisições com a carga da tela do PDV.
    const cancelIdle = runWhenIdle(() => {
      void refreshSyncUi();
      void flushPending();

      stopHeartbeat = startHeartbeat({
        intervalMs: 15_000,
        onBeat: async (info) => {
          setOnline(info.online);
          setLastHeartbeatAt(info.at);
          await db.meta.put({ key: "heartbeat.at", value: info.at });
          await db.meta.put({ key: "heartbeat.tabId", value: info.tabId });
        },
      });

      syncTimer = window.setInterval(() => {
        if (navigator.onLine) void flushPending();
      }, 10_000);
    });

    // Reconexão e mensagens do service worker continuam imediatas.
    const handleOnline = () => {
      setOnline(true);
      void flushPending();
    };
    const handleOffline = () => setOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const onWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === "FLUSH_PENDING_SALES") {
        void flushPending();
      }
    };
    navigator.serviceWorker?.addEventListener("message", onWorkerMessage);

    return () => {
      cancelIdle();
      stopHeartbeat();
      if (syncTimer !== undefined) window.clearInterval(syncTimer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      navigator.serviceWorker?.removeEventListener("message", onWorkerMessage);
    };
  }, [flushPending, loading, refreshSyncUi, setLastHeartbeatAt, setOnline, storeId, userId]);

  return <>{children}</>;
}

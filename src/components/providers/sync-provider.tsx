"use client";

import { useEffect } from "react";
import { useSyncStore } from "@/stores/sync-store";
import { useCheckout } from "@/hooks/use-checkout";
import { listPendingMutations } from "@/lib/offline/db";

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { setOnline, setPendingCount } = useSyncStore();
  const { flushPending } = useCheckout();

  useEffect(() => {
    const refreshPendingCount = async () => {
      const pending = await listPendingMutations();
      setPendingCount(pending.length);
    };

    void refreshPendingCount();

    const handleOnline = () => {
      setOnline(true);
      void flushPending();
    };
    const handleOffline = () => setOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [flushPending, setOnline, setPendingCount]);

  return <>{children}</>;
}

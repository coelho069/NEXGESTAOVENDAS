"use client";

import { useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { getPaymentAdapter } from "@/lib/adapters/payment";
import { closeSale } from "@/lib/offline/close-sale";
import { endClientSession } from "@/lib/offline/end-session";
import { withMultiTabLock } from "@/lib/offline/multi-tab-lock";
import { getPdvLocalDb } from "@/lib/offline/pdv-local-db";
import { isQuotaExceededError } from "@/lib/offline/quota";
import { refreshLocalSyncState, runSyncCycle } from "@/lib/offline/sync-engine";
import { useCartStore } from "@/stores/cart-store";
import { useSyncStore } from "@/stores/sync-store";

function syncDeps(storeId: string | null) {
  return {
    db: getPdvLocalDb(),
    fetchFn: fetch.bind(globalThis),
    storeId,
    onEndSession: endClientSession,
  };
}

export function useCheckout() {
  const { storeId, lines, discount, clear } = useCartStore();
  const {
    setSyncing,
    markSynced,
    setPendingCount,
    setConflicts,
    setQuotaExceeded,
  } = useSyncStore();

  const refreshSyncUi = useCallback(async () => {
    const { pendingCount, conflicts } = await refreshLocalSyncState(getPdvLocalDb());
    setPendingCount(pendingCount);
    setConflicts(conflicts);
    return { pendingCount, conflicts };
  }, [setConflicts, setPendingCount]);

  const flushPending = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await refreshSyncUi();
      return;
    }

    setSyncing(true);
    try {
      await withMultiTabLock(() => runSyncCycle(syncDeps(useCartStore.getState().storeId)));
      const { pendingCount, conflicts } = await refreshSyncUi();
      if (pendingCount === 0 && conflicts.length === 0) markSynced();
    } finally {
      setSyncing(false);
    }
  }, [markSynced, refreshSyncUi, setSyncing]);

  const checkoutCash = useCallback(async () => {
    if (!storeId) throw new Error("Selecione uma loja");
    if (lines.length === 0) throw new Error("Carrinho vazio");

    const adapter = getPaymentAdapter("cash");
    const total = useCartStore.getState().total();
    adapter.process(total);

    const clientMutationId = uuidv4();

    try {
      const result = await closeSale(getPdvLocalDb(), {
        storeId,
        clientMutationId,
        lines,
        discount,
        payments: [{ method: "cash", amount: total }],
      });
      setQuotaExceeded(false);
      clear();

      if (typeof navigator === "undefined" || navigator.onLine) {
        await flushPending();
      } else {
        await refreshSyncUi();
      }

      const pending = useSyncStore.getState().pendingCount;
      return {
        offline: pending > 0 || (typeof navigator !== "undefined" && !navigator.onLine),
        clientMutationId: result.clientMutationId,
        saleId: result.saleId,
        duplicate: result.duplicate,
      };
    } catch (error) {
      if (isQuotaExceededError(error)) {
        setQuotaExceeded(true);
      }
      throw error;
    }
  }, [storeId, lines, discount, clear, flushPending, refreshSyncUi, setQuotaExceeded]);

  return { checkoutCash, flushPending, refreshSyncUi };
}

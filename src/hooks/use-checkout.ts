"use client";

import { useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import type { Enums } from "@/lib/db/types";
import { getPaymentAdapter } from "@/lib/adapters/payment";
import type { CatalogProduct } from "@/lib/domain/catalog";
import { resolvePaymentAttempt } from "@/lib/domain/payment-attempt";
import type { ReceiptModel } from "@/lib/domain/receipt";
import { calculateTotals, validateSale, type MemberRole, type StockMap } from "@/lib/domain/sale-ops";
import { closeSale } from "@/lib/offline/close-sale";
import { endClientSession } from "@/lib/offline/end-session";
import { withMultiTabLock } from "@/lib/offline/multi-tab-lock";
import { getPdvLocalDb } from "@/lib/offline/pdv-local-db";
import { isQuotaExceededError } from "@/lib/offline/quota";
import { ensureLocalInventory } from "@/lib/offline/seed-local-inventory";
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

  const paySale = useCallback(
    async (input: {
      method: Enums<"payment_method">;
      role: MemberRole;
      products: CatalogProduct[];
      storeName: string;
    }): Promise<
      | { ok: true; draft: false; receipt: ReceiptModel; saleId: string; offline: boolean }
      | { ok: false; draft: true; message: string; receipt: null }
    > => {
      const cart = useCartStore.getState();
      if (!cart.storeId) throw new Error("Selecione uma loja");

      const db = getPdvLocalDb();
      await ensureLocalInventory(db, cart.storeId);
      const rows = await db.inventoryBalances.where("storeId").equals(cart.storeId).toArray();
      const liveStock: StockMap = {};
      for (const row of rows) {
        liveStock[row.productId] = row.quantity;
      }

      const saleState = {
        lines: cart.lines,
        discount: cart.discount,
        customerId: cart.customerId,
      };
      const validated = validateSale(saleState, {
        stock: liveStock,
        products: input.products,
        role: input.role,
      });
      if (!validated.ok) {
        throw new Error(validated.error);
      }

      const totals = calculateTotals(saleState);
      const adapter = getPaymentAdapter(input.method);
      const decision = resolvePaymentAttempt(adapter.process(totals.total));
      if (decision.kind === "keep_draft") {
        return { ok: false, draft: true, message: decision.message, receipt: null };
      }

      const clientMutationId = uuidv4();
      try {
        const result = await closeSale(db, {
          storeId: cart.storeId,
          clientMutationId,
          lines: cart.lines,
          discount: cart.discount,
          customerId: cart.customerId ?? undefined,
          payments: [{ method: "cash", amount: totals.total }],
        });
        setQuotaExceeded(false);

        const createdAt = new Date().toISOString();
        const receiptLines = cart.lines;
        const customerName = cart.customerName;
        cart.clear();

        try {
          const online = typeof navigator === "undefined" || navigator.onLine;
          if (online) {
            await flushPending();
          } else {
            await refreshSyncUi();
          }
        } catch {
          await refreshSyncUi();
        }

        const pending = useSyncStore.getState().pendingCount;
        const offline = pending > 0 || (typeof navigator !== "undefined" && !navigator.onLine);
        const syncStatus = offline ? "pending" : "synced";
        const saleStatus = offline ? "pending_sync" : "confirmed";

        const receipt: ReceiptModel = {
          saleId: result.saleId,
          storeName: input.storeName,
          createdAt,
          customerName,
          lines: receiptLines,
          subtotal: totals.subtotal,
          discount: totals.discount,
          total: totals.total,
          payments: [{ method: input.method, amount: totals.total, status: "captured" }],
          syncStatus,
          saleStatus,
        };
        return { ok: true, draft: false, receipt, saleId: result.saleId, offline };
      } catch (error) {
        if (isQuotaExceededError(error)) {
          setQuotaExceeded(true);
        }
        throw error;
      }
    },
    [flushPending, refreshSyncUi, setQuotaExceeded]
  );

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

  return { checkoutCash, paySale, flushPending, refreshSyncUi };
}

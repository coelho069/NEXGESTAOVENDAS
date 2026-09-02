"use client";

import { useCallback, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import type { Enums } from "@/lib/db/types";
import { getPaymentAdapter } from "@/lib/adapters/payment";
import type { CatalogProduct } from "@/lib/domain/catalog";
import { resolvePaymentAttempt, unifyCheckoutPayment } from "@/lib/domain/payment-attempt";
import type { ReceiptModel } from "@/lib/domain/receipt";
import { resolveReceiptSyncState } from "@/lib/domain/receipt-sync";
import {
  calculateTotals,
  isLocalStockEmpty,
  validateSale,
  type MemberRole,
  type StockMap,
} from "@/lib/domain/sale-ops";
import { closeSale } from "@/lib/offline/close-sale";
import { endClientSession } from "@/lib/offline/end-session";
import { withMultiTabLock } from "@/lib/offline/multi-tab-lock";
import { getOutboxCommand } from "@/lib/offline/outbox";
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

async function withCheckoutLock<T>(storeId: string, fn: () => Promise<T>): Promise<T> {
  const result = await withMultiTabLock(fn, { lockName: `nex-pdv-checkout:${storeId}` });
  if (!result.acquired) {
    throw new Error("Checkout já em andamento em outra aba");
  }
  return result.value;
}

export function useCheckout() {
  const {
    clear,
    checkoutAttemptId,
    checkoutInFlight,
  } = useCartStore();
  const checkoutInFlightRef = useRef(false);
  const {
    setSyncing,
    markSynced,
    setPendingCount,
    setFailedCount,
    setConflicts,
    setQuotaExceeded,
  } = useSyncStore();

  const refreshSyncUi = useCallback(async () => {
    const { pendingCount, failedCount, conflicts } = await refreshLocalSyncState(getPdvLocalDb());
    setPendingCount(pendingCount);
    setFailedCount(failedCount);
    setConflicts(conflicts);
    return { pendingCount, conflicts };
  }, [setConflicts, setFailedCount, setPendingCount]);

  const flushPending = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await refreshSyncUi();
      return;
    }

    const storeId = useCartStore.getState().storeId;
    if (!storeId) {
      await refreshSyncUi();
      return;
    }

    setSyncing(true);
    try {
      await withMultiTabLock(
        () => runSyncCycle(syncDeps(storeId)),
        { lockName: `nex-pdv-sync:${storeId}` }
      );
      const { pendingCount, conflicts } = await refreshSyncUi();
      if (pendingCount === 0 && conflicts.length === 0) markSynced();
    } finally {
      setSyncing(false);
    }
  }, [markSynced, refreshSyncUi, setSyncing]);

  const beginCheckout = useCallback((): string => {
    const cart = useCartStore.getState();
    if (checkoutInFlightRef.current || cart.checkoutInFlight) {
      throw new Error("Checkout já em andamento");
    }

    checkoutInFlightRef.current = true;
    cart.setCheckoutInFlight(true);
    const attemptId = cart.checkoutAttemptId ?? uuidv4();
    if (!cart.checkoutAttemptId) {
      cart.setCheckoutAttemptId(attemptId);
    }
    return attemptId;
  }, []);

  const endCheckout = useCallback(() => {
    checkoutInFlightRef.current = false;
    useCartStore.getState().setCheckoutInFlight(false);
  }, []);

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
      const clientMutationId = beginCheckout();
      const cart = useCartStore.getState();
      try {
        if (!cart.storeId) throw new Error("Selecione uma loja");

        const db = getPdvLocalDb();
        const rows = await db.inventoryBalances.where("storeId").equals(cart.storeId).toArray();
        const liveStock: StockMap = {};
        for (const row of rows) {
          liveStock[row.productId] = row.quantity;
        }
        if (isLocalStockEmpty(liveStock)) {
          throw new Error("Estoque local vazio");
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
        const checkout = await withCheckoutLock(cart.storeId, async () => {
          const adapter = getPaymentAdapter(input.method);
          const decision = resolvePaymentAttempt(adapter.process(totals.total));
          if (decision.kind === "keep_draft") {
            return { kind: "draft" as const, message: decision.message };
          }

          const payment = unifyCheckoutPayment(input.method, totals.total);
          const result = await closeSale(db, {
            storeId: cart.storeId!,
            clientMutationId,
            role: input.role,
            lines: cart.lines,
            discount: cart.discount,
            customerId: cart.customerId ?? undefined,
            payments: [payment],
          });
          return { kind: "captured" as const, payment, result };
        });
        if (checkout.kind === "draft") {
          useCartStore.getState().setCheckoutAttemptId(null);
          return { ok: false, draft: true, message: checkout.message, receipt: null };
        }
        const { payment, result } = checkout;
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
        const conflicts = useSyncStore.getState().conflicts;
        const outbox = await getOutboxCommand(db, clientMutationId);
        const online = typeof navigator === "undefined" || navigator.onLine;
        const { syncStatus, saleStatus } = resolveReceiptSyncState({
          pendingCount: pending,
          online,
          outboxStatus: outbox?.status,
          conflictForSale: conflicts.some((conflict) => conflict.clientMutationId === clientMutationId),
        });
        const paymentStatus = syncStatus === "synced" ? "captured" : syncStatus === "failed" ? "failed" : "pending";

        const receipt: ReceiptModel = {
          saleId: result.saleId,
          storeName: input.storeName,
          createdAt,
          customerName,
          lines: receiptLines,
          subtotal: totals.subtotal,
          discount: totals.discount,
          total: totals.total,
          payments: [{ method: payment.method, amount: payment.amount, status: paymentStatus }],
          syncStatus,
          saleStatus,
        };
        return { ok: true, draft: false, receipt, saleId: result.saleId, offline: syncStatus !== "synced" };
      } catch (error) {
        useCartStore.getState().setCheckoutAttemptId(null);
        if (isQuotaExceededError(error)) {
          setQuotaExceeded(true);
        }
        throw error;
      } finally {
        endCheckout();
      }
    },
    [beginCheckout, endCheckout, flushPending, refreshSyncUi, setQuotaExceeded]
  );

  const checkoutCash = useCallback(async (role: MemberRole = "cashier") => {
    const clientMutationId = beginCheckout();

    try {
      const cart = useCartStore.getState();
      if (!cart.storeId) throw new Error("Selecione uma loja");
      if (cart.lines.length === 0) throw new Error("Carrinho vazio");

      const result = await withCheckoutLock(cart.storeId, async () => {
        const adapter = getPaymentAdapter("cash");
        const total = cart.total();
        adapter.process(total);
        const payment = unifyCheckoutPayment("cash", total);
        return closeSale(getPdvLocalDb(), {
          storeId: cart.storeId!,
          clientMutationId,
          role,
          lines: cart.lines,
          discount: cart.discount,
          payments: [payment],
        });
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
      useCartStore.getState().setCheckoutAttemptId(null);
      if (isQuotaExceededError(error)) {
        setQuotaExceeded(true);
      }
      throw error;
    } finally {
      endCheckout();
    }
  }, [beginCheckout, clear, endCheckout, flushPending, refreshSyncUi, setQuotaExceeded]);

  return {
    checkoutCash,
    paySale,
    flushPending,
    refreshSyncUi,
    checkoutAttemptId,
    checkoutInFlight,
  };
}

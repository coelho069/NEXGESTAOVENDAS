"use client";

import { useCallback, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import type { Enums } from "@/lib/db/types";
import { getCommercialPaymentAdapter, getPaymentAdapter } from "@/lib/adapters/payment";
import { inventoryQuantityToNumber } from "@/lib/domain/quantity";
import type { CatalogProduct } from "@/lib/domain/catalog";
import { resolveCashTender } from "@/lib/domain/cash-tender";
import {
  canCompletePaymentOffline,
  offlinePaymentBlockedMessage,
  paymentNotConfiguredMessage,
  toDbPaymentMethod,
  type PaymentMethodKind,
} from "@/lib/domain/payment";
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
import { getPdvLocalDbForUser } from "@/lib/offline/pdv-local-db";
import { isQuotaExceededError } from "@/lib/offline/quota";
import { pdvFixturesEnabled } from "@/lib/pdv/fixtures";
import { appendFixtureSaleCash } from "@/lib/pdv/cash-fixture-ledger";
import { confirmFixtureLocalSales } from "@/lib/domain/sale-return-local";
import {
  reconcilePaymentOutcome,
  reconcileSale,
  refreshLocalSyncState,
  runSyncCycle,
} from "@/lib/offline/sync-engine";
import { useCartStore } from "@/stores/cart-store";
import { useSessionStore } from "@/stores/session-store";
import { useSyncStore } from "@/stores/sync-store";

function syncDeps(storeId: string | null, userId: string | null) {
  return {
    db: getPdvLocalDbForUser(userId),
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
    const { pendingCount, failedCount, conflicts } = await refreshLocalSyncState(
      getPdvLocalDbForUser(useSessionStore.getState().userId)
    );
    setPendingCount(pendingCount);
    setFailedCount(failedCount);
    setConflicts(conflicts);
    return { pendingCount, conflicts };
  }, [setConflicts, setFailedCount, setPendingCount]);

  const flushPending = useCallback(async () => {
    if (pdvFixturesEnabled()) {
      const db = getPdvLocalDbForUser(useSessionStore.getState().userId);
      await confirmFixtureLocalSales(db);
      await refreshSyncUi();
      return;
    }
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
      const userId = useSessionStore.getState().userId;
      await withMultiTabLock(
        () => runSyncCycle(syncDeps(storeId, userId)),
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
      method: PaymentMethodKind | Enums<"payment_method">;
      role: MemberRole;
      products: CatalogProduct[];
      storeName: string;
      cashSessionId?: string;
      terminalId?: string;
      amountReceived?: string;
      operatorName?: string | null;
      customerDocument?: string | null;
      commercialFlags?: {
        require_customer_on_sale?: boolean;
        require_open_cash_session?: boolean;
        require_customer_document?: boolean;
      };
    }): Promise<
      | { ok: true; draft: false; receipt: ReceiptModel; saleId: string; offline: boolean }
      | { ok: false; draft: true; message: string; receipt: null }
    > => {
      const clientMutationId = beginCheckout();
      const cart = useCartStore.getState();
      try {
        if (!cart.storeId) throw new Error("Selecione uma loja");

        const dbMethod = toDbPaymentMethod(input.method);
        const db = getPdvLocalDbForUser(useSessionStore.getState().userId);
        const rows = await db.inventoryBalances.where("storeId").equals(cart.storeId).toArray();
        const liveStock: StockMap = {};
        for (const row of rows) {
          liveStock[row.productId] = inventoryQuantityToNumber(row.quantity);
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
        const cashTender =
          dbMethod === "cash"
            ? resolveCashTender(totals.total, input.amountReceived ?? totals.total)
            : null;
        if (cashTender && !cashTender.ok) {
          throw new Error(cashTender.error);
        }

        const checkout = await withCheckoutLock(cart.storeId, async () => {
          const online = typeof navigator === "undefined" || navigator.onLine;
          if (!online && !canCompletePaymentOffline(input.method)) {
            return {
              kind: "draft" as const,
              message: offlinePaymentBlockedMessage(input.method),
            };
          }

          const adapter = getCommercialPaymentAdapter(input.method);
          const decision = resolvePaymentAttempt(adapter.process(totals.total));
          if (decision.kind === "keep_draft") {
            return {
              kind: "draft" as const,
              message:
                decision.message ||
                paymentNotConfiguredMessage(input.method),
            };
          }

          // Only cash may be enqueued/finalized locally. Card/PIX/TEF never write a paid outbox row.
          if (dbMethod !== "cash") {
            return {
              kind: "draft" as const,
              message: paymentNotConfiguredMessage(input.method),
            };
          }

          // Server authority: payment amount must equal sale total. Tendered/change are receipt-only.
          const payment = unifyCheckoutPayment(dbMethod, totals.total);
          const result = await closeSale(db, {
            storeId: cart.storeId!,
            clientMutationId,
            role: input.role,
            lines: cart.lines,
            discount: cart.discount,
            customerId: cart.customerId ?? undefined,
            customerDocument: input.customerDocument,
            commercialFlags: input.commercialFlags,
            suspendedSaleId: cart.suspendedSaleId ?? undefined,
            suspensionClaimId: cart.suspensionClaimId ?? undefined,
            cashSessionId: input.cashSessionId,
            terminalId: input.terminalId,
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

        if (
          pdvFixturesEnabled() &&
          payment.method === "cash" &&
          input.cashSessionId &&
          input.terminalId
        ) {
          appendFixtureSaleCash({
            userId: useSessionStore.getState().userId,
            storeId: cart.storeId!,
            terminalId: input.terminalId,
            cashSessionId: input.cashSessionId,
            saleId: result.saleId,
            amount: payment.amount,
            clientMutationId,
          });
        }

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
        const localSale = await db.sales.get(result.saleId);
        const online = typeof navigator === "undefined" || navigator.onLine;
        const { syncStatus, saleStatus } = resolveReceiptSyncState({
          pendingCount: pending,
          online,
          outboxStatus: outbox?.status,
          conflictForSale: conflicts.some((conflict) => conflict.clientMutationId === clientMutationId),
        });
        const paymentStatus =
          syncStatus === "synced"
            ? "captured"
            : syncStatus === "failed"
              ? "failed"
              : outbox?.outcomeUnknown
                ? "unknown"
                : "pending";

        const receipt: ReceiptModel = {
          saleId: result.saleId,
          clientMutationId,
          storeName: input.storeName,
          createdAt,
          customerName,
          operatorName: input.operatorName ?? null,
          lines: receiptLines,
          subtotal: totals.subtotal,
          discount: totals.discount,
          total: totals.total,
          amountReceived: cashTender?.ok ? cashTender.amountReceived : undefined,
          changeDue: cashTender?.ok ? cashTender.changeDue : undefined,
          payments: [{ method: payment.method, amount: payment.amount, status: paymentStatus }],
          syncStatus,
          saleStatus,
          fiscalStatus: localSale?.fiscalStatus ?? "pending",
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

  const checkoutCash = useCallback(
    async (
      role: MemberRole = "cashier",
      cashContext?: { cashSessionId?: string; terminalId?: string }
    ) => {
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
        return closeSale(getPdvLocalDbForUser(useSessionStore.getState().userId), {
          storeId: cart.storeId!,
          clientMutationId,
          cashSessionId: cashContext?.cashSessionId,
          terminalId: cashContext?.terminalId,
          role,
          lines: cart.lines,
          discount: cart.discount,
          suspendedSaleId: cart.suspendedSaleId ?? undefined,
          suspensionClaimId: cart.suspensionClaimId ?? undefined,
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
    },
    [beginCheckout, clear, endCheckout, flushPending, refreshSyncUi, setQuotaExceeded]
  );

  const reconcilePayment = useCallback(
    async (input: { storeId: string; clientMutationId: string }) => {
      const response = await fetch("/api/payments/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          store_id: input.storeId,
          client_mutation_id: input.clientMutationId,
        }),
      });

      let body: Record<string, unknown> = {};
      try {
        const json: unknown = await response.json();
        if (json && typeof json === "object") {
          body = json as Record<string, unknown>;
        }
      } catch {
        body = {};
      }

      if (!response.ok) {
        throw new Error(
          typeof body.error === "string"
            ? body.error
            : "Não foi possível reconciliar o pagamento"
        );
      }

      const status = typeof body.status === "string" ? body.status : "unknown";
      if (status === "captured" && typeof body.sale_id === "string") {
        const db = getPdvLocalDbForUser(useSessionStore.getState().userId);
        await reconcileSale(db, input.clientMutationId, {
          sale_id: body.sale_id,
          status,
          total: typeof body.total === "string" || typeof body.total === "number" ? body.total : undefined,
          stockReconciled: true,
        });
      } else if (status === "failed" || status === "cancelled") {
        const db = getPdvLocalDbForUser(useSessionStore.getState().userId);
        await reconcilePaymentOutcome(
          db,
          input.clientMutationId,
          status,
          `Pagamento reconciliado como ${status}`
        );
      }
      await refreshSyncUi();
      return { status, pending: body.pending === true };
    },
    [refreshSyncUi]
  );

  return {
    checkoutCash,
    paySale,
    reconcilePayment,
    flushPending,
    refreshSyncUi,
    checkoutAttemptId,
    checkoutInFlight,
  };
}

"use client";

import { useCallback, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import type { Enums } from "@/lib/db/types";
import { getPaymentAdapter } from "@/lib/adapters/payment";
import { inventoryQuantityToNumber } from "@/lib/domain/quantity";
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
import { confirmFixtureLocalSales } from "@/lib/domain/sale-return-local";
import { recordCapturedCardSale } from "@/lib/offline/close-card-sale";
import { closeSale } from "@/lib/offline/close-sale";
import { endClientSession } from "@/lib/offline/end-session";
import { withMultiTabLock } from "@/lib/offline/multi-tab-lock";
import { getOutboxCommand } from "@/lib/offline/outbox";
import { getPdvLocalDbForUser, type PdvLocalDatabase } from "@/lib/offline/pdv-local-db";
import type { CloseSaleInput, CloseSaleResult } from "@/lib/offline/types";
import { isQuotaExceededError } from "@/lib/offline/quota";
import { pdvFixturesEnabled } from "@/lib/pdv/fixtures";
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
      method: Enums<"payment_method">;
      role: MemberRole;
      products: CatalogProduct[];
      storeName: string;
      cashSessionId?: string;
      terminalId?: string;
    }): Promise<
      | { ok: true; draft: false; receipt: ReceiptModel; saleId: string; offline: boolean }
      | { ok: false; draft: true; message: string; receipt: null }
    > => {
      const clientMutationId = beginCheckout();
      const cart = useCartStore.getState();
      try {
        if (!cart.storeId) throw new Error("Selecione uma loja");

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
        const checkout = await withCheckoutLock(cart.storeId, async () => {
          if (input.method === "card") {
            return payCardOnServer({
              db,
              storeId: cart.storeId!,
              clientMutationId,
              role: input.role,
              lines: cart.lines,
              discount: cart.discount,
              customerId: cart.customerId ?? undefined,
              amount: totals.total,
            });
          }

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
            suspendedSaleId: cart.suspendedSaleId ?? undefined,
            suspensionClaimId: cart.suspensionClaimId ?? undefined,
            cashSessionId: input.cashSessionId,
            terminalId: input.terminalId,
            payments: [payment],
          });
          return { kind: "captured" as const, payment, result };
        });
        if (checkout.kind === "draft" || checkout.kind === "unknown") {
          useCartStore.getState().setCheckoutAttemptId(
            checkout.kind === "unknown" ? clientMutationId : null
          );
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
          lines: receiptLines,
          subtotal: totals.subtotal,
          discount: totals.discount,
          total: totals.total,
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

type CardCheckoutResult =
  | { kind: "draft"; message: string }
  | { kind: "unknown"; message: string }
  | { kind: "captured"; payment: { method: Enums<"payment_method">; amount: string }; result: CloseSaleResult };

async function readJsonBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const json: unknown = await response.json();
    if (json && typeof json === "object") {
      return json as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

async function payCardOnServer(input: {
  db: PdvLocalDatabase;
  storeId: string;
  clientMutationId: string;
  role: MemberRole;
  lines: CloseSaleInput["lines"];
  discount: string;
  customerId?: string;
  amount: string;
}): Promise<CardCheckoutResult> {
  const localAdapter = getPaymentAdapter("card");
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return {
      kind: "draft",
      message: resolvePaymentAttempt(localAdapter.process(input.amount)).kind === "keep_draft"
        ? "Pagamento não configurado. Venda permanece como rascunho local."
        : "Cartão exige conexão. Use dinheiro ou tente novamente.",
    };
  }

  const items = input.lines.map((line) => ({
    product_id: line.productId,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    discount: line.discount,
  }));

  let authorizeResponse: Response;
  try {
    authorizeResponse = await fetch("/api/payments/card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        action: "authorize",
        store_id: input.storeId,
        amount: input.amount,
        client_mutation_id: input.clientMutationId,
        customer_id: input.customerId,
        discount: input.discount,
        items,
      }),
    });
  } catch {
    return {
      kind: "draft",
      message: "Pagamento não configurado. Venda permanece como rascunho local.",
    };
  }
  const authorizeBody = await readJsonBody(authorizeResponse);
  const authorizeStatus = typeof authorizeBody.status === "string" ? authorizeBody.status : "";

  if (
    !authorizeResponse.ok ||
    authorizeStatus === "not_configured" ||
    authorizeBody.configured === false
  ) {
    return {
      kind: "draft",
      message:
        typeof authorizeBody.message === "string"
          ? authorizeBody.message
          : "Pagamento não configurado. Venda permanece como rascunho local.",
    };
  }
  if (authorizeStatus === "unknown") {
    return {
      kind: "unknown",
      message:
        typeof authorizeBody.message === "string"
          ? authorizeBody.message
          : "Pagamento card sem resposta confirmada. Reconcilie; não confirme a venda.",
    };
  }
  if (authorizeStatus !== "authorized" || typeof authorizeBody.provider_reference !== "string") {
    return {
      kind: "draft",
      message:
        typeof authorizeBody.message === "string"
          ? authorizeBody.message
          : "Falha no cartão. Use dinheiro ou tente novamente.",
    };
  }

  let captureResponse: Response;
  try {
    captureResponse = await fetch("/api/payments/card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        action: "capture",
        store_id: input.storeId,
        amount: input.amount,
        client_mutation_id: input.clientMutationId,
        provider_reference: authorizeBody.provider_reference,
        customer_id: input.customerId,
        discount: input.discount,
        items,
      }),
    });
  } catch {
    return {
      kind: "unknown",
      message: "Stripe não confirmou o PaymentIntent. Pagamento permanece unknown.",
    };
  }
  const captureBody = await readJsonBody(captureResponse);
  const captureStatus = typeof captureBody.status === "string" ? captureBody.status : "";
  const saleConfirmed = captureBody.sale_confirmed === true;
  const saleId = typeof captureBody.sale_id === "string" ? captureBody.sale_id : "";
  const providerReference =
    typeof captureBody.provider_reference === "string"
      ? captureBody.provider_reference
      : authorizeBody.provider_reference;

  if (captureResponse.ok && captureStatus === "captured" && saleConfirmed && saleId) {
    const payment = unifyCheckoutPayment("card", input.amount);
    const result = await recordCapturedCardSale(input.db, {
      storeId: input.storeId,
      clientMutationId: input.clientMutationId,
      role: input.role,
      lines: input.lines,
      discount: input.discount,
      customerId: input.customerId,
      payments: [payment],
      serverSaleId: saleId,
      providerReference,
    });
    return { kind: "captured", payment, result };
  }

  if (captureStatus === "unknown" || (captureResponse.ok && captureStatus !== "captured")) {
    return {
      kind: "unknown",
      message:
        typeof captureBody.message === "string"
          ? captureBody.message
          : "Resposta HTTP sem PaymentIntent succeeded. Status unknown; venda não confirmada.",
    };
  }

  return {
    kind: "draft",
    message:
      typeof captureBody.message === "string"
        ? captureBody.message
        : "Falha no cartão. Use dinheiro ou tente novamente.",
  };
}

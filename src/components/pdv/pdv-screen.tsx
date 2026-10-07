"use client";

import { useEffect, useMemo, useState } from "react";
import { PdvSidebar } from "@/components/layout/pdv-sidebar";
import { ProductSearch, focusPdvSearch } from "@/components/pdv/product-search";
import { CartPanel } from "@/components/pdv/cart-panel";
import { SaleSummary } from "@/components/pdv/sale-summary";
import { PaymentSheet } from "@/components/pdv/payment-sheet";
import { PixQrSheet } from "@/components/pdv/pix-qr-sheet";
import { CustomerDialog } from "@/components/pdv/customer-dialog";
import { DiscountDialog } from "@/components/pdv/discount-dialog";
import { QtyDialog } from "@/components/pdv/qty-dialog";
import { CancelItemDialog } from "@/components/pdv/cancel-item-dialog";
import { ReceiptDialog } from "@/components/pdv/receipt-dialog";
import { PdvHotkeysBar } from "@/components/pdv/pdv-hotkeys-bar";
import { ConflictBanner } from "@/components/pdv/conflict-banner";
import { SyncStatusBadge } from "@/components/pdv/sync-status-badge";
import { SuspendedSalesPanel } from "@/components/pdv/suspended-sales-panel";
import { SalesHistoryPanel } from "@/components/pdv/sales-history-panel";
import { SaleReturnDialog } from "@/components/pdv/sale-return-dialog";
import { CashRegisterPanel } from "@/components/cash/cash-register-panel";
import { StoreSelect } from "@/components/auth/store-select";
import { useProducts } from "@/hooks/use-products";
import { useCustomers } from "@/hooks/use-customers";
import { useProjectedStock } from "@/hooks/use-projected-stock";
import { useSuspendedSales } from "@/hooks/use-suspended-sales";
import { useSalesHistory } from "@/hooks/use-sales-history";
import { useCashSession } from "@/hooks/use-cash-session";
import { useHidScanner } from "@/hooks/use-hid-scanner";
import { usePdvShortcuts } from "@/hooks/use-pdv-shortcuts";
import { useCardPaymentHealth } from "@/hooks/use-card-payment-health";
import { usePdvSale } from "@/hooks/use-pdv-sale";
import { resolveOpenCashSaleContext } from "@/lib/domain/cash";
import { lineTotal } from "@/lib/domain/sale";
import { formatBRL } from "@/lib/money";
import { useCartStore } from "@/stores/cart-store";
import { useSyncStore } from "@/stores/sync-store";
import { usePdvUiStore } from "@/stores/pdv-ui-store";
import {
  hasPdvStoreContext,
  resolveAutoStoreId,
  type StoreOption,
} from "@/lib/auth/store-context";
import { useAuth } from "@/hooks/use-auth";
import type { MemberRole } from "@/lib/domain/rbac";
import { snapshotToCartLines, type SuspendedCartContext } from "@/lib/domain/suspended-sale";

type PdvScreenProps = {
  stores: Array<StoreOption & { role?: MemberRole }>;
  initialStoreId: string | null;
  role: MemberRole | null;
};

export function PdvScreen({ stores, initialStoreId, role }: PdvScreenProps) {
  const { loading: authLoading } = useAuth();
  const { customers, createCustomer } = useCustomers();
  const {
    storeId,
    setStoreId,
    suspendedSaleId,
    suspensionClaimId,
    setLines,
    setDiscount,
    setCustomer,
    setSuspendedContext,
  } = useCartStore();
  const cash = useCashSession(storeId);
  const cardSelectable = useCardPaymentHealth();
  const { products, loading, error, fromCatalog } = useProducts({ storeId });
  const { online, pendingCount, failedCount, syncing, conflicts, quotaExceeded, sessionEnded } = useSyncStore();
  const {
    openPanel,
    setOpenPanel,
    lastReceipt,
    pendingPix,
    draftReason,
    inventoryEpoch,
    bumpInventory,
  } = usePdvUiStore();
  const [contextMessage, setContextMessage] = useState<string | null>(null);
  const [showSuspendedSales, setShowSuspendedSales] = useState(false);
  const [showSalesHistory, setShowSalesHistory] = useState(false);
  const [showSaleReturn, setShowSaleReturn] = useState(false);
  const authorizedStore = useMemo(
    () => stores.find((store) => store.id === storeId) ?? null,
    [storeId, stores]
  );
  const hasStoreContext = useMemo(
    () => hasPdvStoreContext(stores, storeId, initialStoreId),
    [initialStoreId, storeId, stores]
  );
  const effectiveRole = role ?? authorizedStore?.role ?? "cashier";
  const displayRole = role ?? authorizedStore?.role ?? null;
  const { balances, loading: stockLoading } = useProjectedStock(storeId, inventoryEpoch);
  const suspended = useSuspendedSales(storeId);
  const salesHistory = useSalesHistory(storeId);
  const [query, setQuery] = useState("");

  const openSalesHistory = () => {
    setShowSalesHistory(true);
    void salesHistory.refresh().catch(() => undefined);
  };

  const storeName = authorizedStore?.name ?? "Loja";
  const cashSale = resolveOpenCashSaleContext({
    session: cash.session,
    terminalId: cash.terminalId,
  });
  const sale = usePdvSale(
    products,
    balances,
    storeName,
    effectiveRole,
    hasStoreContext,
    cashSale.ok ? cashSale.cashSessionId : null,
    cashSale.ok ? cashSale.terminalId : "",
    stockLoading
  );
  const activeSuspendedContext: SuspendedCartContext | null =
    suspendedSaleId && suspensionClaimId
      ? { suspendedSaleId, claimId: suspensionClaimId }
      : null;

  const suspendSale = async () => {
    if (!online) {
      setContextMessage("Suspender venda exige conexão com o servidor. O carrinho foi preservado.");
      return;
    }
    if (sale.lines.length === 0) {
      setContextMessage("Adicione itens antes de suspender a venda.");
      return;
    }
    if (activeSuspendedContext) {
      setContextMessage("Libere a venda recuperada antes de suspender outro carrinho.");
      return;
    }
    try {
      await suspended.suspend({
        lines: sale.lines,
        discount: sale.discount,
        customerId: sale.customerId,
        customerName: sale.customerName,
      });
      useCartStore.getState().clear();
      setContextMessage("Venda suspensa com sucesso. O carrinho foi liberado.");
    } catch (cause) {
      setContextMessage(cause instanceof Error ? cause.message : "Não foi possível suspender a venda.");
    }
  };

  const recoverSale = async (suspendedSaleIdToRecover: string) => {
    try {
      const recovery = await suspended.recover(suspendedSaleIdToRecover);
      const lines = snapshotToCartLines(recovery.snapshot);
      setLines(lines);
      setDiscount(recovery.snapshot.discount);
      setCustomer(recovery.snapshot.customer_id, recovery.snapshot.customer_name);
      setSuspendedContext({
        suspendedSaleId: recovery.suspended_sale_id,
        claimId: recovery.claim_id,
      });
      setShowSuspendedSales(false);
      setContextMessage("Venda recuperada. O snapshot pode ser ajustado antes do checkout.");
    } catch (cause) {
      setContextMessage(cause instanceof Error ? cause.message : "Não foi possível recuperar a venda.");
    }
  };

  const releaseActiveSale = async () => {
    if (!activeSuspendedContext) return;
    try {
      await suspended.release(activeSuspendedContext);
      setSuspendedContext(null);
      setContextMessage("Venda suspensa liberada. O carrinho atual foi preservado.");
    } catch (cause) {
      setContextMessage(cause instanceof Error ? cause.message : "Não foi possível liberar a venda.");
    }
  };

  const reconcileConflict = async (clientMutationId: string) => {
    try {
      const result = await sale.reconcilePaymentByMutation(clientMutationId);
      setContextMessage(
        result.status === "captured"
          ? "Pagamento confirmado pelo servidor."
          : "Pagamento ainda sem confirmação server-side. Nova cobrança foi bloqueada."
      );
    } catch (cause) {
      setContextMessage(
        cause instanceof Error ? cause.message : "Não foi possível reconciliar o pagamento."
      );
    }
  };

  useEffect(() => {
    if (authLoading) return;

    const targetStoreId = resolveAutoStoreId(stores, initialStoreId);
    if (targetStoreId && storeId !== targetStoreId) {
      if (!setStoreId(targetStoreId)) {
        setContextMessage(
          initialStoreId
            ? "A loja da URL não pode substituir o carrinho aberto."
            : "Não é possível trocar de loja com o carrinho aberto."
        );
      }
      return;
    }
    if (storeId && !authorizedStore && sale.lines.length === 0 && !sale.checkoutInFlight && !sale.checkoutAttemptId) {
      setStoreId(null);
    }
  }, [
    authLoading,
    authorizedStore,
    initialStoreId,
    sale.checkoutAttemptId,
    sale.checkoutInFlight,
    sale.lines.length,
    setStoreId,
    storeId,
    stores,
  ]);

  const checkoutDisabled =
    !hasStoreContext ||
    sessionEnded ||
    syncing ||
    sale.checkoutInFlight ||
    sale.lines.length === 0 ||
    Boolean(error) ||
    products.length === 0 ||
    Object.keys(balances).length === 0 ||
    !cash.canSell;

  useHidScanner(
    sale.scanCode,
    true,
    openPanel !== "none" || showSuspendedSales || showSalesHistory || showSaleReturn
  );

  const modalOpen =
    openPanel !== "none" || showSuspendedSales || showSalesHistory || showSaleReturn;

  const closeAllPanels = () => {
    setOpenPanel("none");
    setShowSuspendedSales(false);
    setShowSalesHistory(false);
    setShowSaleReturn(false);
  };

  const openPaymentSheet = () => {
    if (checkoutDisabled) return;
    setOpenPanel("payment");
  };

  const selectedLine = useMemo(() => {
    const id = sale.selectedProductId ?? sale.lines.at(-1)?.productId ?? null;
    return id ? sale.lines.find((item) => item.productId === id) ?? null : null;
  }, [sale.lines, sale.selectedProductId]);

  const [qtyDraft, setQtyDraft] = useState("");
  const [qtyError, setQtyError] = useState<string | null>(null);

  const confirmQtyDraft = () => {
    if (!selectedLine) {
      setOpenPanel("none");
      return;
    }
    const parsed = Number(qtyDraft.replace(",", "."));
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
      setQtyError("Informe uma quantidade inteira maior ou igual a 1.");
      return;
    }
    sale.changeQty(selectedLine.productId, parsed);
    setQtyDraft("");
    setQtyError(null);
    setOpenPanel("none");
    focusPdvSearch();
  };

  const confirmCancelItem = () => {
    if (selectedLine) sale.removeLine(selectedLine.productId);
    setOpenPanel("none");
    focusPdvSearch();
  };

  usePdvShortcuts({
    search: () => {
      closeAllPanels();
      focusPdvSearch();
    },
    customer: () => setOpenPanel("customer"),
    discount: () => {
      sale.setDiscountDraft(sale.discount);
      setOpenPanel("discount");
    },
    finalize: openPaymentSheet,
    // F10 (extra): PIX está restrito (not_configured) — abre a sheet apenas
    // para consulta; o método só fica ativo quando um health-check for ligado.
    payPix: openPaymentSheet,
    qtyEdit: () => {
      if (!selectedLine) return;
      setQtyDraft(String(selectedLine.quantity));
      setQtyError(null);
      setOpenPanel("qty");
    },
    cancelItem: () => {
      if (!selectedLine) return;
      setOpenPanel("cancel-item");
    },
    salesHistory: () => {
      closeAllPanels();
      openSalesHistory();
    },
    cancel: closeAllPanels,
    removeLine: () => {
      const id = sale.selectedProductId ?? sale.lines.at(-1)?.productId;
      if (id) sale.removeLine(id);
    },
    qtyInc: () => {
      const id = sale.selectedProductId ?? sale.lines.at(-1)?.productId;
      const line = sale.lines.find((item) => item.productId === id);
      if (line) sale.changeQty(line.productId, line.quantity + 1);
    },
    qtyDec: () => {
      const id = sale.selectedProductId ?? sale.lines.at(-1)?.productId;
      const line = sale.lines.find((item) => item.productId === id);
      if (line) sale.changeQty(line.productId, line.quantity - 1);
    },
  }, modalOpen);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <PdvSidebar storeId={storeId} role={role} onOpenSalesHistory={openSalesHistory} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-4 overflow-y-auto p-4 lg:p-6">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground lg:hidden">
                P
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground" style={{ fontFamily: "var(--font-jakarta), system-ui, sans-serif" }}>
                  Vendas
                </h1>
                <p className="text-sm text-muted-foreground">PDV local-first · scanner HID e recibo</p>
              </div>
            </div>
            <SyncStatusBadge
              online={online}
              pendingCount={pendingCount}
              failedCount={failedCount}
              syncing={syncing}
              conflictCount={conflicts.length}
            />
          </header>

          <div className="pdv-glass-bar flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium text-foreground" htmlFor="store">
              Loja
            </label>
            <StoreSelect
              id="store"
              testId="store-select"
              className="pdv-input w-auto min-w-[12rem]"
              stores={stores}
              value={storeId}
              disabled={Boolean(sale.checkoutAttemptId) || sale.checkoutInFlight || sale.lines.length > 0}
              onChange={(nextStoreId) => {
                if (nextStoreId && !stores.some((store) => store.id === nextStoreId)) return;
                if (!setStoreId(nextStoreId)) {
                  setContextMessage("Não é possível trocar de loja com o carrinho aberto.");
                  return;
                }
                setContextMessage(null);
              }}
            />
            <span data-testid="role-display" className="text-sm text-muted-foreground">
              Papel: {roleLabel(displayRole)}
            </span>
            {fromCatalog ? (
              <span className="text-xs text-muted-foreground">Catálogo local</span>
            ) : null}
          </div>

          {!hasStoreContext ? (
            <div data-testid="store-context-denied" className="pdv-alert-warning">
              Selecione uma loja autorizada antes de adicionar produtos ou fechar uma venda.
            </div>
          ) : null}

          <CashRegisterPanel storeId={storeId} cash={cash} />

          {contextMessage ? (
            <div data-testid="store-context-message" className="pdv-alert-warning">
              {contextMessage}
            </div>
          ) : null}

          {sessionEnded ? (
            <div className="pdv-alert-warning">
              Sessão encerrada. Faça login novamente.
            </div>
          ) : null}

          {quotaExceeded ? (
            <div role="alert" data-testid="quota-exceeded" className="pdv-alert-error">
              Armazenamento local cheio. Libere espaço antes de fechar novas vendas.
            </div>
          ) : null}

          <ConflictBanner conflicts={conflicts} onReconcile={reconcileConflict} />

          {draftReason ? (
            <div role="status" data-testid="sale-draft-banner" className="pdv-alert-warning">
              Rascunho local: {draftReason}
            </div>
          ) : null}

          {sale.message ? (
            <div className="pdv-alert-info">
              {sale.message}
            </div>
          ) : null}

          {error ? (
            <div role="alert" data-testid="catalog-error" className="pdv-alert-error">
              {error}
            </div>
          ) : null}

          <div
            data-testid="pdv-layout"
            className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]"
          >
            <div className="flex min-h-0 flex-col gap-4">
              <ProductSearch
                products={products}
                loading={loading || stockLoading}
                query={query}
                onQueryChange={setQuery}
                onPick={(product) => {
                  sale.addProduct(product);
                  if (openPanel === "none") focusPdvSearch();
                }}
                stock={balances}
                cartQty={sale.cartQty}
              />
              <CartPanel
                lines={sale.lines}
                selectedProductId={sale.selectedProductId}
                onSelect={sale.setSelectedProductId}
                onIncrement={(productId) => {
                  const line = sale.lines.find((item) => item.productId === productId);
                  if (line) sale.changeQty(productId, line.quantity + 1);
                }}
                onDecrement={(productId) => {
                  const line = sale.lines.find((item) => item.productId === productId);
                  if (line) sale.changeQty(productId, line.quantity - 1);
                }}
                onQuantity={sale.changeQty}
                onRemove={sale.removeLine}
              />
            </div>
            <div className="min-h-0">
              <SaleSummary
                totals={sale.totals}
                customerName={sale.customerName}
                customerRequired={sale.requireCustomer}
                discountLabel={sale.discount}
                checkoutDisabled={checkoutDisabled}
                suspendDisabled={
                  !hasStoreContext ||
                  !online ||
                  sessionEnded ||
                  syncing ||
                  sale.checkoutInFlight ||
                  sale.lines.length === 0 ||
                  Boolean(activeSuspendedContext)
                }
                online={online}
                onCustomer={() => setOpenPanel("customer")}
                onDiscount={() => {
                  sale.setDiscountDraft(sale.discount);
                  setOpenPanel("discount");
                }}
                onOpenPayment={() => setOpenPanel("payment")}
                onSuspend={() => void suspendSale()}
                onOpenSuspended={() => {
                  setShowSuspendedSales(true);
                  void suspended.refresh().catch(() => undefined);
                }}
                onOpenSalesHistory={openSalesHistory}
              />
            </div>
          </div>

          <PaymentSheet
            open={openPanel === "payment"}
            total={sale.totals.total}
            disabled={checkoutDisabled}
            cardSelectable={cardSelectable}
            onCash={() => void sale.pay("cash")}
            onCard={() => void sale.pay("card")}
            onPixManual={() => void sale.pay("pix_manual")}
            onClose={() => setOpenPanel("none")}
          />
          <PixQrSheet
            open={openPanel === "pix-qr"}
            pending={pendingPix}
            storeId={storeId}
            onClose={() => setOpenPanel("none")}
            onCancel={() => sale.cancelPendingPixCheckout()}
            onConfirmed={(input) => sale.confirmPendingPix(input)}
          />
          <CustomerDialog
            open={openPanel === "customer"}
            customers={customers}
            selectedId={sale.customerId}
            requireCustomer={sale.requireCustomer}
            onSelect={sale.associateCustomer}
            onCreate={createCustomer}
            onClose={() => setOpenPanel("none")}
          />
          <DiscountDialog
            open={openPanel === "discount"}
            value={sale.discountDraft}
            max={sale.maxDiscount}
            role={effectiveRole}
            error={sale.discountError}
            onChange={sale.setDiscountDraft}
            onApply={() => {
              sale.applyDiscountValue(sale.discountDraft);
            }}
            onClose={() => setOpenPanel("none")}
          />
          <QtyDialog
            open={openPanel === "qty"}
            productName={selectedLine?.name ?? null}
            lineTotal={selectedLine ? formatBRL(lineTotal(selectedLine)) : ""}
            value={qtyDraft}
            error={qtyError}
            onChange={(value) => {
              setQtyDraft(value);
              setQtyError(null);
            }}
            onConfirm={confirmQtyDraft}
            onClose={() => setOpenPanel("none")}
          />
          <CancelItemDialog
            open={openPanel === "cancel-item"}
            productName={selectedLine?.name ?? null}
            lineTotal={selectedLine ? formatBRL(lineTotal(selectedLine)) : ""}
            onConfirm={confirmCancelItem}
            onClose={() => setOpenPanel("none")}
          />
          <ReceiptDialog
            open={openPanel === "receipt"}
            receipt={lastReceipt}
            onClose={() => setOpenPanel("none")}
            onReconcile={sale.reconcileLastPayment}
          />
          <SuspendedSalesPanel
            open={showSuspendedSales}
            rows={suspended.rows}
            loading={suspended.loading}
            mutating={suspended.mutating}
            error={suspended.error}
            cartHasItems={sale.lines.length > 0}
            activeContext={activeSuspendedContext}
            onRefresh={suspended.refresh}
            onRecover={recoverSale}
            onReleaseActive={releaseActiveSale}
            onClose={() => setShowSuspendedSales(false)}
          />
          <SalesHistoryPanel
            open={showSalesHistory && !showSaleReturn}
            rows={salesHistory.rows}
            detail={salesHistory.detail}
            loading={salesHistory.loading}
            detailLoading={salesHistory.detailLoading}
            error={salesHistory.error}
            query={salesHistory.query}
            hasMore={salesHistory.hasMore}
            role={displayRole}
            onQueryChange={salesHistory.setQuery}
            onRefresh={() => void salesHistory.refresh()}
            onLoadMore={() => void salesHistory.loadMore()}
            onOpenDetail={(saleId) => void salesHistory.openDetail(saleId)}
            onClearDetail={salesHistory.clearDetail}
            onStartReturn={() => setShowSaleReturn(true)}
            onClose={() => {
              setShowSalesHistory(false);
              setShowSaleReturn(false);
              salesHistory.clearDetail();
            }}
          />
          <SaleReturnDialog
            open={showSaleReturn}
            detail={salesHistory.detail}
            role={displayRole}
            mutating={salesHistory.mutating}
            error={salesHistory.error}
            onSubmit={async (input) => {
              if (!salesHistory.detail) return;
              await salesHistory.submitReturn({
                saleId: salesHistory.detail.sale_id,
                operation: input.operation,
                reason: input.reason,
                notes: input.notes,
                items: input.items,
                cashSessionId: cash.session?.cash_session_id ?? null,
              });
              bumpInventory();
              await cash.refresh().catch(() => undefined);
              setShowSaleReturn(false);
            }}
            onClose={() => setShowSaleReturn(false)}
          />
        </div>
        <PdvHotkeysBar />
      </div>
    </div>
  );
}

function roleLabel(role: MemberRole | null): string {
  if (role === "admin") return "Admin";
  if (role === "manager") return "Gerente";
  if (role === "cashier") return "Caixa";
  if (role === "client") return "Cliente";
  return "Não disponível";
}
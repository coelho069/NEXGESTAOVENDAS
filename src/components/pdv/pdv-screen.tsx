"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PdvSidebar } from "@/components/layout/pdv-sidebar";
import { ProductSearch, focusPdvSearch } from "@/components/pdv/product-search";
import { CartPanel } from "@/components/pdv/cart-panel";
import { SaleSummary } from "@/components/pdv/sale-summary";
import { PaymentSheet } from "@/components/pdv/payment-sheet";
import { CustomerDialog } from "@/components/pdv/customer-dialog";
import { DiscountDialog } from "@/components/pdv/discount-dialog";
import { ReceiptDialog } from "@/components/pdv/receipt-dialog";
import { ConflictBanner } from "@/components/pdv/conflict-banner";
import { SyncStatusBadge } from "@/components/pdv/sync-status-badge";
import { SuspendedSalesPanel } from "@/components/pdv/suspended-sales-panel";
import { SalesHistoryPanel } from "@/components/pdv/sales-history-panel";
import { SaleReturnDialog } from "@/components/pdv/sale-return-dialog";
import { SettingsPanel } from "@/components/pdv/settings-panel";
import { CashRegisterPanel } from "@/components/cash/cash-register-panel";
import { useProducts } from "@/hooks/use-products";
import { useCustomers } from "@/hooks/use-customers";
import { useProjectedStock } from "@/hooks/use-projected-stock";
import { useSuspendedSales } from "@/hooks/use-suspended-sales";
import { useSalesHistory } from "@/hooks/use-sales-history";
import { useCashSession } from "@/hooks/use-cash-session";
import { useStoreSettings } from "@/hooks/use-store-settings";
import { useHidScanner } from "@/hooks/use-hid-scanner";
import { usePdvShortcuts } from "@/hooks/use-pdv-shortcuts";
import { usePdvSale } from "@/hooks/use-pdv-sale";
import { useCartStore } from "@/stores/cart-store";
import { useSyncStore } from "@/stores/sync-store";
import { usePdvUiStore } from "@/stores/pdv-ui-store";
import type { StoreOption } from "@/lib/auth/store-context";
import type { MemberRole } from "@/lib/domain/rbac";
import { canManageCustomers, canViewStoreSettings } from "@/lib/domain/rbac";
import {
  enrichReceiptWithSettings,
  saleBlockedBySettings,
} from "@/lib/domain/store-settings";
import { snapshotToCartLines, type SuspendedCartContext } from "@/lib/domain/suspended-sale";

type PdvScreenProps = {
  stores: Array<StoreOption & { role?: MemberRole }>;
  initialStoreId: string | null;
  role: MemberRole | null;
};

export function PdvScreen({ stores, initialStoreId, role }: PdvScreenProps) {
  const {
    storeId,
    setStoreId,
    customerId,
    suspendedSaleId,
    suspensionClaimId,
    setLines,
    setDiscount,
    setCustomer,
    setSuspendedContext,
  } = useCartStore();
  const customersApi = useCustomers(storeId);
  const { search: searchCustomer } = customersApi;
  const searchCustomers = useCallback((query: string) => {
    void searchCustomer(query);
  }, [searchCustomer]);
  const cash = useCashSession(storeId);
  const { products, loading, error, fromCatalog } = useProducts({ storeId });
  const { online, pendingCount, failedCount, syncing, conflicts, quotaExceeded, sessionEnded } = useSyncStore();
  const {
    openPanel,
    setOpenPanel,
    lastReceipt,
    draftReason,
    inventoryEpoch,
    bumpInventory,
  } = usePdvUiStore();
  const [contextMessage, setContextMessage] = useState<string | null>(null);
  const [showSuspendedSales, setShowSuspendedSales] = useState(false);
  const [showSalesHistory, setShowSalesHistory] = useState(false);
  const [showSaleReturn, setShowSaleReturn] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const authorizedStore = useMemo(
    () => stores.find((store) => store.id === storeId) ?? null,
    [storeId, stores]
  );
  const storeContextMatchesRoute = !initialStoreId || storeId === initialStoreId;
  const hasStoreContext = Boolean(authorizedStore && storeContextMatchesRoute);
  const effectiveRole = role ?? authorizedStore?.role ?? "cashier";
  const displayRole = role ?? authorizedStore?.role ?? null;
  const { balances, loading: stockLoading } = useProjectedStock(storeId, inventoryEpoch);
  const suspended = useSuspendedSales(storeId);
  const salesHistory = useSalesHistory(storeId);
  const storeSettings = useStoreSettings(hasStoreContext ? storeId : null, displayRole);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (openPanel !== "receipt" || !lastReceipt?.saleId) return;
    void cash.refresh().catch(() => undefined);
    // Refresh once per closed sale so fixture sale_cash appears on the ledger.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- avoid re-entry when cash memo updates
  }, [lastReceipt?.saleId, openPanel]);

  const storeName = authorizedStore?.name ?? "Loja";
  const selectedCustomerDocument =
    customersApi.customers.find((customer) => customer.id === customerId)?.document ?? null;
  const sale = usePdvSale(
    products,
    balances,
    storeName,
    effectiveRole,
    hasStoreContext,
    cash.session?.cash_session_id ?? null,
    cash.terminalId,
    {
      customerDocument: selectedCustomerDocument,
      commercialFlags: storeSettings.settings
        ? {
            require_customer_on_sale: storeSettings.settings.require_customer_on_sale,
            require_open_cash_session: storeSettings.settings.require_open_cash_session,
            require_customer_document: storeSettings.settings.require_customer_document,
          }
        : undefined,
    }
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
    if (initialStoreId && storeId !== initialStoreId) {
      if (!setStoreId(initialStoreId)) {
        setContextMessage("A loja da URL não pode substituir o carrinho aberto.");
      }
      return;
    }
    if (storeId && !authorizedStore && sale.lines.length === 0 && !sale.checkoutInFlight && !sale.checkoutAttemptId) {
      setStoreId(null);
      return;
    }
  }, [
    authorizedStore,
    initialStoreId,
    sale.checkoutAttemptId,
    sale.checkoutInFlight,
    sale.lines.length,
    setStoreId,
    storeId,
    stores,
  ]);

  useHidScanner(
    sale.scanCode,
    true,
    openPanel !== "none" || showSettings || showSalesHistory || showSuspendedSales,
    storeSettings.settings?.beep_on_scan !== false
  );

  const assertSaleSettings = useCallback(() => {
    if (storeSettings.error) {
      setContextMessage(
        "Configurações da loja indisponíveis; não é possível fechar a venda com segurança."
      );
      return false;
    }
    if (!storeSettings.settings) {
      if (storeSettings.loading) {
        setContextMessage("Carregando configurações da loja…");
        return false;
      }
      setContextMessage(
        "Configurações da loja indisponíveis; não é possível fechar a venda com segurança."
      );
      return false;
    }
    const blocked = saleBlockedBySettings({
      settings: storeSettings.settings,
      customerId: sale.customerId,
      customerDocument: selectedCustomerDocument,
      cashSessionOpen: cash.session?.status === "open",
    });
    if (blocked) {
      setContextMessage(blocked);
      return false;
    }
    return true;
  }, [
    cash.session?.status,
    sale.customerId,
    selectedCustomerDocument,
    storeSettings.error,
    storeSettings.loading,
    storeSettings.settings,
  ]);

  usePdvShortcuts({
    search: () => {
      setOpenPanel("none");
      focusPdvSearch();
    },
    customer: () => setOpenPanel("customer"),
    discount: () => {
      sale.setDiscountDraft(sale.discount);
      setOpenPanel("discount");
    },
    payment: () => {
      if (!assertSaleSettings()) return;
      setOpenPanel("payment");
      document.querySelector<HTMLButtonElement>("[data-testid=checkout-cash]")?.focus();
    },
    receipt: () => {
      if (lastReceipt) setOpenPanel("receipt");
    },
    cancel: () => setOpenPanel("none"),
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
  }, openPanel !== "none" || showSettings);

  const requireOpenCash = Boolean(storeSettings.settings?.require_open_cash_session);
  const checkoutDisabled =
    !hasStoreContext ||
    sessionEnded ||
    syncing ||
    sale.checkoutInFlight ||
    sale.lines.length === 0 ||
    Boolean(error) ||
    products.length === 0 ||
    Object.keys(balances).length === 0 ||
    // Only force open cash when the store commercial rule demands it.
    (requireOpenCash && !cash.canSell);

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <PdvSidebar
        storeId={storeId}
        onOpenCustomers={() => setOpenPanel("customer")}
        onOpenSalesHistory={() => {
          setShowSalesHistory(true);
          void salesHistory.refresh().catch(() => undefined);
        }}
        onOpenSettings={
          hasStoreContext && canViewStoreSettings(displayRole)
            ? () => {
                setShowSettings(true);
                void storeSettings.refresh();
              }
            : undefined
        }
      />
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-4 p-4 lg:p-6">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white lg:hidden">
                P
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Vendas</h1>
                <p className="text-sm text-slate-500">PDV local-first · scanner HID e recibo</p>
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

          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <label className="text-sm font-medium text-slate-700" htmlFor="store">
              Loja
            </label>
            <select
              id="store"
              data-testid="store-select"
              className="rounded-lg border border-slate-300 px-3 py-2"
              value={storeId ?? ""}
              disabled={Boolean(sale.checkoutAttemptId) || sale.checkoutInFlight || sale.lines.length > 0}
              onChange={(event) => {
                const nextStoreId = event.target.value || null;
                if (nextStoreId && !stores.some((store) => store.id === nextStoreId)) return;
                if (!setStoreId(nextStoreId)) {
                  setContextMessage("Não é possível trocar de loja com o carrinho aberto.");
                  return;
                }
                setContextMessage(null);
              }}
            >
              <option value="">Selecione...</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
            <span data-testid="role-display" className="text-sm text-slate-500">
              Papel: {roleLabel(displayRole)}
            </span>
            {fromCatalog ? (
              <span className="text-xs text-slate-500">Catálogo local</span>
            ) : null}
          </div>

          {!hasStoreContext ? (
            <div data-testid="store-context-denied" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Selecione uma loja autorizada antes de adicionar produtos ou fechar uma venda.
            </div>
          ) : null}

          <CashRegisterPanel storeId={storeId} cash={cash} />

          {contextMessage ? (
            <div data-testid="store-context-message" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {contextMessage}
            </div>
          ) : null}

          {sessionEnded ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              Sessão encerrada. Faça login novamente.
            </div>
          ) : null}

          {quotaExceeded ? (
            <div
              role="alert"
              data-testid="quota-exceeded"
              className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
            >
              Armazenamento local cheio. Libere espaço antes de fechar novas vendas.
            </div>
          ) : null}

          <ConflictBanner conflicts={conflicts} onReconcile={reconcileConflict} />

          {draftReason ? (
            <div
              role="status"
              data-testid="sale-draft-banner"
              className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            >
              Rascunho local: {draftReason}
            </div>
          ) : null}

          {sale.message ? (
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800">
              {sale.message}
            </div>
          ) : null}

          {error ? (
            <div
              role="alert"
              data-testid="catalog-error"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              {error}
            </div>
          ) : null}

          <div
            data-testid="pdv-layout"
            className="grid flex-1 gap-4 md:grid-cols-2 lg:grid-cols-[minmax(20rem,1.3fr)_minmax(20rem,1fr)_minmax(18rem,0.8fr)]"
          >
            <ProductSearch
              products={products}
              loading={loading || stockLoading}
              query={query}
              onQueryChange={setQuery}
              onPick={sale.addProduct}
              stock={balances}
              cartQty={sale.cartQty}
            />
            <CartPanel
              lines={sale.lines}
              selectedProductId={sale.selectedProductId}
              stock={balances}
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
              onClear={() => {
                if (sale.checkoutInFlight) return;
                useCartStore.getState().clear();
                setContextMessage("Carrinho limpo.");
              }}
            />
            <div className="md:col-span-2 lg:col-span-1">
              <SaleSummary
                totals={sale.totals}
                customerName={sale.customerName}
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
                onOpenPayment={() => {
                  if (!assertSaleSettings()) return;
                  setOpenPanel("payment");
                }}
                onSuspend={() => void suspendSale()}
                onOpenSuspended={() => {
                  setShowSuspendedSales(true);
                  void suspended.refresh().catch(() => undefined);
                }}
                onOpenSalesHistory={() => {
                  setShowSalesHistory(true);
                  void salesHistory.refresh().catch(() => undefined);
                }}
              />
            </div>
          </div>

          <PaymentSheet
            open={openPanel === "payment"}
            total={sale.totals.total}
            disabled={checkoutDisabled}
            online={online}
            onCash={(amountReceived) => {
              if (!assertSaleSettings()) return;
              void sale.pay("cash", amountReceived).then(() => {
                const receipt = usePdvUiStore.getState().lastReceipt;
                if (receipt && storeSettings.settings) {
                  usePdvUiStore
                    .getState()
                    .setLastReceipt(enrichReceiptWithSettings(receipt, storeSettings.settings));
                }
              });
            }}
            onCreditCard={() => void sale.pay("credit_card")}
            onDebitCard={() => void sale.pay("debit_card")}
            onPix={() => void sale.pay("pix")}
            onTef={() => void sale.pay("tef")}
            onClose={() => setOpenPanel("none")}
          />
          <CustomerDialog
            open={openPanel === "customer"}
            customers={customersApi.customers}
            selectedId={sale.customerId}
            canManage={canManageCustomers(effectiveRole)}
            requireDocument={Boolean(storeSettings.settings?.require_customer_document)}
            loading={customersApi.loading}
            mutating={customersApi.mutating}
            error={customersApi.error}
            detail={customersApi.detail}
            detailLoading={customersApi.detailLoading}
            onSearch={searchCustomers}
            onSelect={sale.associateCustomer}
            onSave={customersApi.save}
            onOpenDetail={(customerId) => void customersApi.openDetail(customerId)}
            onLoadMoreDetail={() => void customersApi.loadMoreDetail()}
            onClearDetail={customersApi.clearDetail}
            onClose={() => {
              customersApi.clearDetail();
              setOpenPanel("none");
            }}
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
          <ReceiptDialog
            open={openPanel === "receipt"}
            receipt={
              lastReceipt
                ? enrichReceiptWithSettings(lastReceipt, storeSettings.settings)
                : null
            }
            autoPrint={Boolean(storeSettings.settings?.auto_print_receipt)}
            printMode={storeSettings.settings?.print_mode ?? "browser"}
            paperWidthMm={storeSettings.settings?.paper_width_mm ?? 80}
            storeId={storeId}
            orgId={storeSettings.settings?.org_id ?? null}
            onClose={() => setOpenPanel("none")}
            onReconcile={sale.reconcileLastPayment}
          />
          <SettingsPanel
            open={showSettings}
            data={storeSettings.data}
            loading={storeSettings.loading}
            saving={storeSettings.saving}
            error={storeSettings.error}
            savedAt={storeSettings.savedAt}
            onSave={storeSettings.save}
            onRefresh={() => void storeSettings.refresh()}
            onClose={() => setShowSettings(false)}
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
            open={showSalesHistory}
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
      </div>
    </div>
  );
}

function roleLabel(role: MemberRole | null): string {
  if (role === "admin") return "Admin";
  if (role === "manager") return "Gerente";
  if (role === "cashier") return "Caixa";
  return "Não disponível";
}
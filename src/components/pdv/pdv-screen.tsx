"use client";

import { useState } from "react";
import { ProductSearch, focusPdvSearch } from "@/components/pdv/product-search";
import { CartPanel } from "@/components/pdv/cart-panel";
import { SaleSummary } from "@/components/pdv/sale-summary";
import { PaymentSheet } from "@/components/pdv/payment-sheet";
import { CustomerDialog } from "@/components/pdv/customer-dialog";
import { DiscountDialog } from "@/components/pdv/discount-dialog";
import { ReceiptDialog } from "@/components/pdv/receipt-dialog";
import { ConflictBanner } from "@/components/pdv/conflict-banner";
import { SyncStatusBadge } from "@/components/pdv/sync-status-badge";
import { useProducts } from "@/hooks/use-products";
import { useCustomers } from "@/hooks/use-customers";
import { useProjectedStock } from "@/hooks/use-projected-stock";
import { useHidScanner } from "@/hooks/use-hid-scanner";
import { usePdvShortcuts } from "@/hooks/use-pdv-shortcuts";
import { usePdvSale } from "@/hooks/use-pdv-sale";
import { useCartStore } from "@/stores/cart-store";
import { useSyncStore } from "@/stores/sync-store";
import { usePdvUiStore } from "@/stores/pdv-ui-store";

const DEMO_STORES = [
  { id: "22222222-2222-4222-8222-222222222201", name: "Loja Centro" },
  { id: "22222222-2222-4222-8222-222222222202", name: "Loja Shopping" },
];

export function PdvScreen() {
  const { products, loading, error, fromCatalog } = useProducts();
  const { customers } = useCustomers();
  const { storeId, setStoreId } = useCartStore();
  const { online, pendingCount, failedCount, syncing, conflicts, quotaExceeded, sessionEnded } = useSyncStore();
  const {
    role,
    setRole,
    openPanel,
    setOpenPanel,
    lastReceipt,
    draftReason,
    inventoryEpoch,
  } = usePdvUiStore();
  const { balances } = useProjectedStock(storeId, inventoryEpoch);
  const [query, setQuery] = useState("");

  const storeName = DEMO_STORES.find((store) => store.id === storeId)?.name ?? "Loja";
  const sale = usePdvSale(products, balances, storeName);

  useHidScanner(sale.scanCode, true, openPanel !== "none");

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
  }, openPanel !== "none");

  const checkoutDisabled =
    !storeId ||
    sessionEnded ||
    syncing ||
    sale.checkoutInFlight ||
    sale.lines.length === 0 ||
    Boolean(error) ||
    products.length === 0 ||
    Object.keys(balances).length === 0;

  return (
    <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-4 p-4 lg:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">PDV Local-first</h1>
          <p className="text-sm text-slate-500">Sprint 3 — interface de vendas, scanner HID e recibo</p>
        </div>
        <SyncStatusBadge
          online={online}
          pendingCount={pendingCount}
          failedCount={failedCount}
          syncing={syncing}
          conflictCount={conflicts.length}
        />
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-slate-700" htmlFor="store">
          Loja
        </label>
        <select
          id="store"
          data-testid="store-select"
          className="rounded-lg border border-slate-300 px-3 py-2"
          value={storeId ?? ""}
          disabled={Boolean(sale.checkoutAttemptId) || sale.checkoutInFlight || sale.lines.length > 0}
          onChange={(event) => setStoreId(event.target.value)}
        >
          <option value="">Selecione...</option>
          {DEMO_STORES.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </select>
        <label className="text-sm font-medium text-slate-700" htmlFor="role">
          Papel
        </label>
        <select
          id="role"
          data-testid="role-select"
          className="rounded-lg border border-slate-300 px-3 py-2"
          value={role}
          onChange={(event) => setRole(event.target.value as typeof role)}
        >
          <option value="cashier">Caixa</option>
          <option value="manager">Gerente</option>
          <option value="admin">Admin</option>
        </select>
        {fromCatalog ? (
          <span className="text-xs text-slate-500">Catálogo local</span>
        ) : null}
      </div>

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

      <ConflictBanner conflicts={conflicts} />

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
        className="grid flex-1 gap-4 md:grid-cols-2 lg:grid-cols-[minmax(16rem,1.05fr)_minmax(18rem,1.2fr)_minmax(16rem,0.9fr)]"
      >
        <ProductSearch
          products={products}
          loading={loading}
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
        />
        <div className="md:col-span-2 lg:col-span-1">
          <SaleSummary
            totals={sale.totals}
            customerName={sale.customerName}
            discountLabel={sale.discount}
            checkoutDisabled={checkoutDisabled}
            onCustomer={() => setOpenPanel("customer")}
            onDiscount={() => {
              sale.setDiscountDraft(sale.discount);
              setOpenPanel("discount");
            }}
            onCash={() => void sale.pay("cash")}
            onCard={() => void sale.pay("card")}
            onOpenPayment={() => setOpenPanel("payment")}
          />
        </div>
      </div>

      <PaymentSheet
        open={openPanel === "payment"}
        total={sale.totals.total}
        disabled={checkoutDisabled}
        onCash={() => void sale.pay("cash")}
        onCard={() => void sale.pay("card")}
        onClose={() => setOpenPanel("none")}
      />
      <CustomerDialog
        open={openPanel === "customer"}
        customers={customers}
        selectedId={sale.customerId}
        onSelect={sale.associateCustomer}
        onClose={() => setOpenPanel("none")}
      />
      <DiscountDialog
        open={openPanel === "discount"}
        value={sale.discountDraft}
        max={sale.maxDiscount}
        role={role}
        error={sale.discountError}
        onChange={sale.setDiscountDraft}
        onApply={() => {
          sale.applyDiscountValue(sale.discountDraft);
        }}
        onClose={() => setOpenPanel("none")}
      />
      <ReceiptDialog
        open={openPanel === "receipt"}
        receipt={lastReceipt}
        onClose={() => setOpenPanel("none")}
      />
    </div>
  );
}
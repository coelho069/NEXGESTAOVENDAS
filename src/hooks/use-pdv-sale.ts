"use client";

import { useCallback, useMemo, useState } from "react";
import type { Enums } from "@/lib/db/types";
import type { ProductRow } from "@/lib/domain/product";
import { findProductByScan, toCatalogProduct, type CatalogCustomer } from "@/lib/domain/catalog";
import {
  addItem,
  applyDiscount,
  calculateTotals,
  cartQtyByProduct,
  maxDiscountForRole,
  parseMoneyInput,
  setQuantity,
  type SaleState,
} from "@/lib/domain/sale-ops";
import { useCheckout } from "@/hooks/use-checkout";
import { useCartStore } from "@/stores/cart-store";
import { usePdvUiStore } from "@/stores/pdv-ui-store";

function saleSnapshot(): SaleState {
  const cart = useCartStore.getState();
  return {
    lines: cart.lines,
    discount: cart.discount,
    customerId: cart.customerId,
  };
}

function applyState(state: SaleState): void {
  const cart = useCartStore.getState();
  cart.setLines(state.lines);
  cart.setDiscount(state.discount);
  if (state.customerId !== cart.customerId) {
    cart.setCustomer(state.customerId, state.customerId ? cart.customerName : null);
  }
}

export function usePdvSale(products: ProductRow[], stock: Record<string, number>, storeName: string) {
  const catalog = useMemo(() => products.map(toCatalogProduct), [products]);
  const { lines, discount, customerId, customerName, setCustomer, removeLine } = useCartStore();
  const {
    role,
    selectedProductId,
    setSelectedProductId,
    setOpenPanel,
    setLastReceipt,
    setDraftReason,
    bumpInventory,
  } = usePdvUiStore();
  const { paySale, checkoutAttemptId, checkoutInFlight } = useCheckout();
  const [message, setMessage] = useState<string | null>(null);
  const [discountDraft, setDiscountDraft] = useState(discount);
  const [discountError, setDiscountError] = useState<string | null>(null);

  const totals = useMemo(
    () => calculateTotals({ lines, discount, customerId }),
    [lines, discount, customerId]
  );
  const cartQty = useMemo(() => cartQtyByProduct(lines), [lines]);

  const report = useCallback((text: string | null) => {
    setMessage(text);
  }, []);

  const addProduct = useCallback(
    (product: ProductRow) => {
      if (checkoutInFlight) return;
      const result = addItem(saleSnapshot(), toCatalogProduct(product), 1, stock);
      if (!result.ok) {
        report(result.error);
        return;
      }
      applyState(result.state);
      setSelectedProductId(product.id);
      setDraftReason(null);
      report(null);
    },
    [checkoutInFlight, report, setDraftReason, setSelectedProductId, stock]
  );

  const scanCode = useCallback(
    (code: string) => {
      const match = findProductByScan(catalog, code);
      if (!match) {
        report(`Código não encontrado: ${code}`);
        return;
      }
      const row = products.find((item) => item.id === match.productId);
      if (row) addProduct(row);
    },
    [addProduct, catalog, products, report]
  );

  const changeQty = useCallback(
    (productId: string, quantity: number) => {
      if (checkoutInFlight) return;
      const product = catalog.find((item) => item.productId === productId);
      const result = setQuantity(saleSnapshot(), productId, quantity, stock, product);
      if (!result.ok) {
        report(result.error);
        return;
      }
      applyState(result.state);
      report(null);
    },
    [catalog, checkoutInFlight, report, stock]
  );

  const removeCartLine = useCallback(
    (productId: string) => {
      if (checkoutInFlight) return;
      removeLine(productId);
    },
    [checkoutInFlight, removeLine]
  );

  const applyDiscountValue = useCallback(
    (raw: string) => {
      if (checkoutInFlight) return false;
      const parsed = parseMoneyInput(raw);
      if (!parsed) {
        setDiscountError("Valor inválido");
        return false;
      }
      const result = applyDiscount(saleSnapshot(), parsed, role);
      if (!result.ok) {
        setDiscountError(result.error);
        return false;
      }
      applyState(result.state);
      setDiscountError(null);
      setOpenPanel("none");
      report(null);
      return true;
    },
    [checkoutInFlight, report, role, setOpenPanel]
  );

  const associateCustomer = useCallback(
    (customer: CatalogCustomer | null) => {
      if (checkoutInFlight) return;
      setCustomer(customer?.id ?? null, customer?.name ?? null);
      setOpenPanel("none");
    },
    [checkoutInFlight, setCustomer, setOpenPanel]
  );

  const pay = useCallback(
    async (method: Enums<"payment_method">) => {
      setMessage(null);
      try {
        const result = await paySale({
          method,
          role,
          products: catalog,
          storeName,
        });
        if (!result.ok) {
          setDraftReason(result.message);
          setOpenPanel("none");
          report(result.message);
          return;
        }
        setDraftReason(null);
        setLastReceipt(result.receipt);
        bumpInventory();
        setOpenPanel("receipt");
        report(null);
      } catch (error) {
        report(error instanceof Error ? error.message : "Erro no pagamento");
      }
    },
    [bumpInventory, catalog, paySale, report, role, setDraftReason, setLastReceipt, setOpenPanel, storeName]
  );

  return {
    lines,
    discount,
    customerId,
    customerName,
    totals,
    cartQty,
    message,
    discountDraft,
    discountError,
    maxDiscount: maxDiscountForRole(totals.subtotal, role),
    addProduct,
    scanCode,
    changeQty,
    removeLine: removeCartLine,
    applyDiscountValue,
    associateCustomer,
    pay,
    checkoutAttemptId,
    checkoutInFlight,
    setDiscountDraft,
    setSelectedProductId,
    selectedProductId,
  };
}
"use client";

import { useCallback, useMemo, useState } from "react";
import { useProducts } from "@/hooks/useProducts";
import { parseUnitPrice, cartTotal } from "@/lib/domain/sale";
import type { ProductRow } from "@/lib/domain/product";
import { soleAuthorizedStoreId, type StoreOption } from "@/lib/auth/store-context";
import { useCartStore } from "@/stores/useCartStore";
import { Button } from "@/components/ui/button";
import { StoreSelect } from "@/components/auth/store-select";

type ProductSearchProps = {
  scopeKey?: string;
  onProductAdded?: (product: ProductRow) => void;
  stores?: StoreOption[];
  initialStoreId?: string | null;
};

export function ProductSearch({
  scopeKey = "default",
  onProductAdded,
  stores = [],
  initialStoreId = null,
}: ProductSearchProps) {
  const [query, setQuery] = useState("");
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(() => {
    if (initialStoreId && stores.some((store) => store.id === initialStoreId)) return initialStoreId;
    return soleAuthorizedStoreId(stores);
  });
  const [contextMessage, setContextMessage] = useState<string | null>(null);
  const addLine = useCartStore((state) => state.addLine);
  const cartStoreId = useCartStore((state) => state.storeId);
  const setCartStoreId = useCartStore((state) => state.setStoreId);
  const lines = useCartStore((state) => state.lines);
  const discount = useCartStore((state) => state.discount);
  const total = useMemo(() => cartTotal(lines, discount), [discount, lines]);
  const itemCount = useMemo(
    () => lines.reduce((count, line) => count + line.quantity, 0),
    [lines]
  );
  const cartStoreIsAuthorized = stores.some((store) => store.id === cartStoreId);
  const cartStoreMatchesInitial = !initialStoreId || cartStoreId === initialStoreId;
  const activeStoreId = cartStoreIsAuthorized && cartStoreMatchesInitial ? cartStoreId : selectedStoreId;
  const activeStore = stores.find((store) => store.id === activeStoreId);
  const canAdd = Boolean(
    activeStoreId &&
      activeStore &&
      (!initialStoreId || activeStoreId === initialStoreId) &&
      (!cartStoreId || cartStoreId === activeStoreId)
  );
  const { filteredProducts, loading, error, reload, source } = useProducts({
    query,
    scopeKey,
    storeId: activeStoreId,
  });

  const handleStoreChange = useCallback(
    (nextStoreId: string) => {
      const nextStore = stores.find((store) => store.id === nextStoreId);
      if (!nextStore) return;

      if (!setCartStoreId(nextStore.id)) {
        setContextMessage("Não é possível trocar de loja com o carrinho aberto.");
        return;
      }

      setSelectedStoreId(nextStore.id);
      setContextMessage(null);
    },
    [setCartStoreId, stores]
  );

  const addProduct = useCallback(
    (product: ProductRow) => {
      if (!canAdd || !activeStoreId) {
        setContextMessage("Selecione uma loja autorizada antes de adicionar produtos.");
        return;
      }

      if (!cartStoreId && !setCartStoreId(activeStoreId)) {
        setContextMessage("Não foi possível definir a loja do carrinho.");
        return;
      }

      addLine({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        unitPrice: parseUnitPrice(product.unit_price),
        quantity: 1,
        discount: "0.00",
      });
      setContextMessage(null);
      onProductAdded?.(product);
    },
    [activeStoreId, addLine, canAdd, cartStoreId, onProductAdded, setCartStoreId]
  );

  return (
    <section
      aria-labelledby="product-search-title"
      data-testid="feature-product-search"
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="product-search-title" className="text-lg font-semibold text-slate-900">
            Produtos
          </h2>
          <p className="text-sm text-slate-500">Busque por nome, SKU ou código de barras.</p>
        </div>
        {source === "fixtures" ? (
          <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-900">Catálogo local</span>
        ) : null}
      </div>

      <label className="sr-only" htmlFor="feature-product-query">
        Buscar produto
      </label>
      <input
        id="feature-product-query"
        className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
        placeholder="Produto, SKU ou código de barras"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="feature-store" className="font-medium text-slate-700">
          Loja
        </label>
        <StoreSelect
          id="feature-store"
          testId="feature-store"
          className="rounded-lg border border-slate-300 px-2 py-1"
          stores={stores}
          value={activeStoreId}
          onChange={(nextStoreId) => {
            if (nextStoreId) handleStoreChange(nextStoreId);
          }}
          disabled={stores.length === 0}
        />
        {stores.length === 0 ? (
          <span data-testid="feature-store-denied" className="text-slate-500">
            Nenhuma loja autorizada para esta sessão.
          </span>
        ) : null}
      </div>

      {contextMessage ? (
        <div data-testid="feature-store-message" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {contextMessage}
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <span>{error}</span>
          <Button variant="secondary" onClick={() => void reload()}>
            Tentar novamente
          </Button>
        </div>
      ) : null}

      <div className="mt-4">
        {loading ? <p className="text-sm text-slate-500">Carregando produtos...</p> : null}
        {!loading && filteredProducts.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum produto encontrado.</p>
        ) : null}
        <ul className="grid gap-2 sm:grid-cols-2">
          {filteredProducts.map((product) => (
            <li
              key={product.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 p-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{product.name}</p>
                <p className="text-xs text-slate-500">
                  {product.sku} · R$ {parseUnitPrice(product.unit_price).replace(".", ",")}
                </p>
              </div>
              <Button disabled={!canAdd} onClick={() => addProduct(product)}>
                Adicionar
              </Button>
            </li>
          ))}
        </ul>
      </div>

      <footer className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
        <span className="text-slate-600">
          Carrinho: <strong className="text-slate-900">{itemCount}</strong> item(ns)
        </span>
        <span className="font-semibold text-slate-900">R$ {total.replace(".", ",")}</span>
      </footer>
    </section>
  );
}

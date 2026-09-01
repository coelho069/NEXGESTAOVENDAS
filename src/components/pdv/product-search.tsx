"use client";

import { useMemo } from "react";
import { searchProducts, type ProductRow } from "@/lib/domain/product";
import { findProductByScan, toCatalogProduct } from "@/lib/domain/catalog";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ProductGrid } from "@/components/pdv/product-grid";

type ProductSearchProps = {
  products: ProductRow[];
  loading: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onPick: (product: ProductRow) => void;
  stock: Record<string, number>;
  cartQty: Record<string, number>;
};

export function ProductSearch({
  products,
  loading,
  query,
  onQueryChange,
  onPick,
  stock,
  cartQty,
}: ProductSearchProps) {
  const debouncedQuery = useDebouncedValue(query, 300);
  const filtered = useMemo(() => searchProducts(products, debouncedQuery), [products, debouncedQuery]);

  return (
    <section
      data-testid="pdv-search"
      className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-slate-900">Busca</h2>
      <p className="text-xs text-slate-500">F2 / Ctrl+K · scanner HID adiciona sem limpar o carrinho</p>
      <input
        id="pdv-search-input"
        data-testid="pdv-search-input"
        className="mt-3 rounded-lg border border-slate-300 px-3 py-2"
        placeholder="Produto, SKU ou código de barras"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          const match = findProductByScan(products.map(toCatalogProduct), query);
          const row = match ? products.find((item) => item.id === match.productId) : filtered[0];
          if (row) onPick(row);
        }}
      />
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-slate-500">Carregando produtos...</p>
        ) : (
          <ProductGrid products={filtered} onAdd={onPick} stock={stock} cartQty={cartQty} />
        )}
      </div>
    </section>
  );
}

export function focusPdvSearch(): void {
  document.getElementById("pdv-search-input")?.focus();
}
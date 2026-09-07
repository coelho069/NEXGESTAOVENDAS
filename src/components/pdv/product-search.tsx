"use client";

import { useMemo } from "react";
import { Search } from "lucide-react";
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
      className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">Produtos</h2>
          <p className="text-xs text-slate-500">F2 / Ctrl+K · scanner HID adiciona sem limpar o carrinho</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-500">Catálogo</span>
      </div>
      <div className="relative mt-3">
        <Search
          size={18}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          id="pdv-search-input"
          data-testid="pdv-search-input"
          className="w-full rounded-xl border border-slate-200 py-2 pl-10 pr-4 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
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
      </div>
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
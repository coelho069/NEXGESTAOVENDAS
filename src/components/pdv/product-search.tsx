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
  const debouncedQuery = useDebouncedValue(query, 150);
  const filtered = useMemo(() => searchProducts(products, debouncedQuery), [products, debouncedQuery]);

  const pickFirstResult = () => {
    const match = findProductByScan(products.map(toCatalogProduct), query);
    const row = match ? products.find((item) => item.id === match.productId) : filtered[0];
    if (row) onPick(row);
  };

  return (
    <section data-testid="pdv-search" className="pdv-panel flex min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Produtos</h2>
          <p className="text-xs text-muted-foreground">F2 · Enter adiciona o 1º resultado · scanner HID</p>
        </div>
        {loading ? (
          <span
            data-testid="pdv-search-loading"
            className="rounded-full border border-warning/30 bg-warning/10 px-2 py-1 text-xs font-medium text-amber-200"
          >
            Atualizando…
          </span>
        ) : (
          <span className="rounded-full border border-border bg-background/40 px-2 py-1 text-xs text-muted-foreground">
            Catálogo
          </span>
        )}
      </div>
      <div className="relative mt-3">
        <Search
          size={18}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          id="pdv-search-input"
          data-testid="pdv-search-input"
          className="pdv-input py-2.5 pl-10 pr-4"
          placeholder="Produto, SKU ou código de barras"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            pickFirstResult();
          }}
        />
      </div>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        <ProductGrid products={filtered} onAdd={onPick} stock={stock} cartQty={cartQty} />
      </div>
    </section>
  );
}

export function focusPdvSearch(): void {
  document.getElementById("pdv-search-input")?.focus();
}

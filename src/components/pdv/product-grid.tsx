import { Plus } from "lucide-react";
import { formatBRL } from "@/lib/money";
import type { ProductRow } from "@/lib/domain/product";
import { StockLabel } from "@/components/pdv/stock-label";

type ProductGridProps = {
  products: ProductRow[];
  onAdd: (product: ProductRow) => void;
  stock?: Record<string, number>;
  cartQty?: Record<string, number>;
};

export function ProductGrid({ products, onAdd, stock, cartQty }: ProductGridProps) {
  if (products.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-slate-500">
        Nenhum produto encontrado.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {products.map((product) => {
        const inCart = cartQty?.[product.id] ?? 0;
        return (
          <button
            key={product.id}
            type="button"
            data-testid={`product-sku-${product.sku}`}
            onClick={() => onAdd(product)}
            className="group rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm outline-none transition-all hover:border-indigo-500 hover:shadow-md focus-visible:ring-2 focus-visible:ring-indigo-200"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="rounded bg-indigo-50 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-indigo-600">
                {product.sku}
              </div>
              <div className="text-lg font-semibold tabular-nums text-slate-800">{formatBRL(product.unit_price)}</div>
            </div>
            <div className="mt-3 font-semibold text-slate-700 transition-colors group-hover:text-indigo-600">
              {product.name}
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <StockLabel
                productId={product.id}
                sku={product.sku}
                stockQty={stock?.[product.id]}
                cartQty={inCart}
              />
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                <Plus size={16} aria-hidden="true" />
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
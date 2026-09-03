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
    <div className="grid grid-cols-1 gap-3">
      {products.map((product) => {
        const inCart = cartQty?.[product.id] ?? 0;
        return (
          <button
            key={product.id}
            type="button"
            data-testid={`product-sku-${product.sku}`}
            onClick={() => onAdd(product)}
            className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-emerald-500 hover:shadow"
          >
            <div className="text-sm font-medium text-slate-500">{product.sku}</div>
            <div className="mt-1 font-semibold text-slate-900">{product.name}</div>
            <div className="mt-2">
              <StockLabel
                productId={product.id}
                sku={product.sku}
                stockQty={stock?.[product.id]}
                cartQty={inCart}
              />
            </div>
            <div className="mt-2 text-lg font-bold text-emerald-700">{formatBRL(product.unit_price)}</div>
          </button>
        );
      })}
    </div>
  );
}
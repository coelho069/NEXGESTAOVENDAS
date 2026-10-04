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
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground">
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
            className="group rounded-2xl border border-border bg-background/30 p-4 text-left shadow-sm transition-all hover:border-primary/50 hover:bg-background/50 hover:shadow-md hover:shadow-primary/10"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="rounded border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-bold uppercase tracking-wider text-primary">
                {product.sku}
              </div>
              <div className="text-lg font-bold text-foreground tabular-nums">{formatBRL(product.unit_price)}</div>
            </div>
            <div className="mt-3 font-semibold text-foreground/90 transition-colors group-hover:text-primary">
              {product.name}
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <StockLabel
                productId={product.id}
                sku={product.sku}
                stockQty={stock?.[product.id]}
                cartQty={inCart}
              />
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
                <Plus size={16} aria-hidden="true" />
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

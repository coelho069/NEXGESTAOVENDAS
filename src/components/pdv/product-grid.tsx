import { formatBRL } from "@/lib/money";
import type { ProductRow } from "@/lib/domain/product";

type ProductGridProps = {
  products: ProductRow[];
  onAdd: (product: ProductRow) => void;
};

export function ProductGrid({ products, onAdd }: ProductGridProps) {
  if (products.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-slate-500">
        Nenhum produto encontrado.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {products.map((product) => (
        <button
          key={product.id}
          type="button"
          onClick={() => onAdd(product)}
          className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-emerald-500 hover:shadow"
        >
          <div className="text-sm font-medium text-slate-500">{product.sku}</div>
          <div className="mt-1 font-semibold text-slate-900">{product.name}</div>
          <div className="mt-3 text-lg font-bold text-emerald-700">
            {formatBRL(product.unit_price)}
          </div>
        </button>
      ))}
    </div>
  );
}

import { formatBRL } from "@/lib/money";
import type { CartLine } from "@/lib/domain/sale";
import { lineTotal } from "@/lib/domain/sale";
import { StockLabel } from "@/components/pdv/stock-label";

type CartPanelProps = {
  lines: CartLine[];
  selectedProductId: string | null;
  stock: Record<string, number>;
  onSelect: (productId: string) => void;
  onIncrement: (productId: string) => void;
  onDecrement: (productId: string) => void;
  onQuantity: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
};

export function CartPanel({
  lines,
  selectedProductId,
  stock,
  onSelect,
  onIncrement,
  onDecrement,
  onQuantity,
  onRemove,
}: CartPanelProps) {
  return (
    <section
      data-testid="pdv-cart"
      className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-slate-900">Carrinho</h2>
      <p className="text-xs text-slate-500">+/- altera a linha selecionada</p>
      <div className="mt-4 flex-1 space-y-3 overflow-y-auto">
        {lines.length === 0 ? (
          <p className="text-sm text-slate-500">Adicione produtos para iniciar a venda.</p>
        ) : (
          lines.map((line) => {
            const selected = selectedProductId === line.productId;
            return (
              <div
                key={line.productId}
                data-testid={`cart-line-${line.sku}`}
                className={`rounded-lg border p-3 ${selected ? "border-emerald-500 bg-emerald-50" : "border-slate-100"}`}
                onClick={() => onSelect(line.productId)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-slate-900">{line.name}</div>
                    <div className="text-xs text-slate-500">
                      {line.sku} · {formatBRL(line.unitPrice)}
                    </div>
                    <StockLabel
                      productId={line.productId}
                      sku={line.sku}
                      stockQty={stock[line.productId]}
                      cartQty={line.quantity}
                    />
                  </div>
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:underline"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemove(line.productId);
                    }}
                  >
                    Remover
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      data-testid={`cart-dec-${line.sku}`}
                      className="h-8 w-8 rounded border border-slate-200"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDecrement(line.productId);
                      }}
                    >
                      -
                    </button>
                    <input
                      data-testid={`cart-qty-${line.sku}`}
                      className="h-8 w-14 rounded border border-slate-200 text-center"
                      value={line.quantity}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isFinite(value)) onQuantity(line.productId, value);
                      }}
                      onClick={(event) => event.stopPropagation()}
                    />
                    <button
                      type="button"
                      data-testid={`cart-inc-${line.sku}`}
                      className="h-8 w-8 rounded border border-slate-200"
                      onClick={(event) => {
                        event.stopPropagation();
                        onIncrement(line.productId);
                      }}
                    >
                      +
                    </button>
                  </div>
                  <div className="font-semibold text-slate-900">{formatBRL(lineTotal(line))}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
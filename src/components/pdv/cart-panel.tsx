import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
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
      className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
        <ShoppingCart size={20} aria-hidden="true" />
        Carrinho
      </h2>
      <p className="text-xs text-slate-500">+/- altera a linha selecionada</p>
      <div className="mt-4 flex-1 space-y-3 overflow-y-auto">
        {lines.length === 0 ? (
          <div
            data-testid="cart-empty"
            className="flex h-full flex-col items-center justify-center gap-3 text-center text-slate-400"
          >
            <ShoppingCart size={48} strokeWidth={1} aria-hidden="true" />
            <p className="text-sm">
              O carrinho está vazio.
              <br />
              Selecione produtos para começar.
            </p>
          </div>
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
                    aria-label={`Remover ${line.name}`}
                    title="Remover item"
                    className="text-slate-300 transition-colors hover:text-red-500"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemove(line.productId);
                    }}
                  >
                    <Trash2 size={18} aria-hidden="true" />
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      data-testid={`cart-dec-${line.sku}`}
                      aria-label={`Diminuir ${line.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDecrement(line.productId);
                      }}
                    >
                      <Minus size={14} aria-hidden="true" />
                    </button>
                    <label className="sr-only" htmlFor={`cart-qty-${line.sku}`}>
                      Quantidade de {line.name}
                    </label>
                    <input
                      id={`cart-qty-${line.sku}`}
                      data-testid={`cart-qty-${line.sku}`}
                      className="h-8 w-14 rounded-lg border border-slate-200 text-center"
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
                      aria-label={`Aumentar ${line.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                      onClick={(event) => {
                        event.stopPropagation();
                        onIncrement(line.productId);
                      }}
                    >
                      <Plus size={14} aria-hidden="true" />
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
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
      <p className="text-xs text-slate-500">+/- altera a linha selecionada · Del remove</p>
      {lines.length > 0 ? (
        <div
          className="mt-3 hidden grid-cols-[4.5rem_minmax(0,1fr)_5.5rem_5.5rem] gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:grid"
          aria-hidden="true"
        >
          <span>Qtd</span>
          <span>Nome</span>
          <span className="text-right">Unit</span>
          <span className="text-right">Subtotal</span>
        </div>
      ) : null}
      <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
        {lines.length === 0 ? (
          <div
            data-testid="cart-empty"
            className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-2 text-center text-slate-400"
          >
            <ShoppingCart size={40} strokeWidth={1} aria-hidden="true" />
            <p className="text-sm">Carrinho vazio. Busque ou escaneie um produto.</p>
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
                <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_5.5rem_5.5rem] items-start gap-2">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      data-testid={`cart-dec-${line.sku}`}
                      aria-label={`Diminuir ${line.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
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
                      className="h-7 w-10 rounded-lg border border-slate-200 text-center text-sm tabular-nums"
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
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                      onClick={(event) => {
                        event.stopPropagation();
                        onIncrement(line.productId);
                      }}
                    >
                      <Plus size={14} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-900">{line.name}</div>
                    <div className="truncate text-xs text-slate-500">{line.sku}</div>
                    <StockLabel
                      productId={line.productId}
                      sku={line.sku}
                      stockQty={stock[line.productId]}
                      cartQty={line.quantity}
                    />
                  </div>
                  <div className="self-center text-right text-sm text-slate-600 tabular-nums">
                    {formatBRL(line.unitPrice)}
                  </div>
                  <div className="flex items-start justify-end gap-1 self-center">
                    <span className="font-bold text-slate-900 tabular-nums">{formatBRL(lineTotal(line))}</span>
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
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { formatBRL } from "@/lib/money";
import type { CartLine } from "@/lib/domain/sale";
import { lineTotal } from "@/lib/domain/sale";

type CartPanelProps = {
  lines: CartLine[];
  selectedProductId: string | null;
  onSelect: (productId: string) => void;
  onIncrement: (productId: string) => void;
  onDecrement: (productId: string) => void;
  onQuantity: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
};

export function CartPanel({
  lines,
  selectedProductId,
  onSelect,
  onIncrement,
  onDecrement,
  onQuantity,
  onRemove,
}: CartPanelProps) {
  return (
    <section data-testid="pdv-cart" className="pdv-panel flex min-h-0 flex-col">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <ShoppingCart size={20} aria-hidden="true" />
        Carrinho
      </h2>
      <p className="text-xs text-muted-foreground">+/- altera a linha selecionada · Del remove</p>
      {lines.length > 0 ? (
        <div
          className="mt-3 hidden grid-cols-[4.5rem_minmax(0,1fr)_5.5rem_5.5rem] gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid"
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
            className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-2 text-center text-muted-foreground"
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
                className={selected ? "pdv-line-selected" : "pdv-line-default"}
                onClick={() => onSelect(line.productId)}
              >
                <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_5.5rem_5.5rem] items-start gap-2">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      data-testid={`cart-dec-${line.sku}`}
                      aria-label={`Diminuir ${line.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-foreground hover:bg-white/5"
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
                      className="h-7 w-10 rounded-lg border border-input bg-background/50 text-center text-sm text-foreground tabular-nums"
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
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-foreground hover:bg-white/5"
                      onClick={(event) => {
                        event.stopPropagation();
                        onIncrement(line.productId);
                      }}
                    >
                      <Plus size={14} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{line.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{line.sku}</div>
                  </div>
                  <div className="self-center text-right text-sm text-muted-foreground tabular-nums">
                    {formatBRL(line.unitPrice)}
                  </div>
                  <div className="flex items-start justify-end gap-1 self-center">
                    <span className="font-bold text-foreground tabular-nums">{formatBRL(lineTotal(line))}</span>
                    <button
                      type="button"
                      aria-label={`Remover ${line.name}`}
                      title="Remover item"
                      className="text-muted-foreground transition-colors hover:text-destructive"
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

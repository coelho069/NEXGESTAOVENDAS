import { formatBRL } from "@/lib/money";
import type { CartLine } from "@/lib/domain/sale";
import { lineTotal } from "@/lib/domain/sale";

type CartPanelProps = {
  lines: CartLine[];
  discount: string;
  total: string;
  onIncrement: (productId: string) => void;
  onDecrement: (productId: string) => void;
  onRemove: (productId: string) => void;
  onCheckout: () => void;
  checkoutDisabled?: boolean;
};

export function CartPanel({
  lines,
  discount,
  total,
  onIncrement,
  onDecrement,
  onRemove,
  onCheckout,
  checkoutDisabled,
}: CartPanelProps) {
  return (
    <aside className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Carrinho</h2>
      <div className="mt-4 flex-1 space-y-3 overflow-y-auto">
        {lines.length === 0 ? (
          <p className="text-sm text-slate-500">Adicione produtos para iniciar a venda.</p>
        ) : (
          lines.map((line) => (
            <div key={line.productId} className="rounded-lg border border-slate-100 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-slate-900">{line.name}</div>
                  <div className="text-xs text-slate-500">{formatBRL(line.unitPrice)}</div>
                </div>
                <button
                  type="button"
                  className="text-xs text-red-600 hover:underline"
                  onClick={() => onRemove(line.productId)}
                >
                  Remover
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="h-8 w-8 rounded border border-slate-200"
                    onClick={() => onDecrement(line.productId)}
                  >
                    -
                  </button>
                  <span className="w-8 text-center">{line.quantity}</span>
                  <button
                    type="button"
                    className="h-8 w-8 rounded border border-slate-200"
                    onClick={() => onIncrement(line.productId)}
                  >
                    +
                  </button>
                </div>
                <div className="font-semibold text-slate-900">{formatBRL(lineTotal(line))}</div>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm">
        <div className="flex justify-between text-slate-600">
          <span>Desconto</span>
          <span>{formatBRL(discount)}</span>
        </div>
        <div className="flex justify-between text-lg font-bold text-slate-900">
          <span>Total</span>
          <span>{formatBRL(total)}</span>
        </div>
      </div>
      <button
        type="button"
        disabled={checkoutDisabled || lines.length === 0}
        onClick={onCheckout}
        className="mt-4 rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        Finalizar (Dinheiro)
      </button>
    </aside>
  );
}

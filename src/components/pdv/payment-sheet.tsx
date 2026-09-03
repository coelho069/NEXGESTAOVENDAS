import { formatBRL } from "@/lib/money";
import { PaymentActions } from "@/components/pdv/sale-summary";

type PaymentSheetProps = {
  open: boolean;
  total: string;
  disabled: boolean;
  onCash: () => void;
  onCard: () => void;
  onClose: () => void;
};

export function PaymentSheet({ open, total, disabled, onCash, onCard, onClose }: PaymentSheetProps) {
  if (!open) return null;

  return (
    <div data-testid="pdv-payment-sheet" className="fixed inset-0 z-50 lg:hidden">
      <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Fechar pagamento" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Pagamento</h2>
          <button type="button" className="text-sm text-slate-500" onClick={onClose}>
            Esc
          </button>
        </div>
        <p className="mb-4 text-2xl font-bold text-slate-900">{formatBRL(total)}</p>
        <PaymentActions disabled={disabled} onCash={onCash} onCard={onCard} />
      </div>
    </div>
  );
}
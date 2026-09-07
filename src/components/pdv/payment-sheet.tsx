import { X } from "lucide-react";
import { formatBRL } from "@/lib/money";
import { PaymentActions } from "@/components/pdv/sale-summary";

type PaymentSheetProps = {
  open: boolean;
  total: string;
  disabled: boolean;
  cardSelectable?: boolean;
  pixSelectable?: boolean;
  onCash: () => void;
  onCard: () => void;
  onPix?: () => void;
  onClose: () => void;
};

export function PaymentSheet({
  open,
  total,
  disabled,
  cardSelectable = false,
  pixSelectable = false,
  onCash,
  onCard,
  onPix,
  onClose,
}: PaymentSheetProps) {
  if (!open) return null;

  return (
    <div data-testid="pdv-payment-sheet" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        aria-label="Fechar pagamento"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 p-6">
          <h2 className="text-xl font-bold text-slate-900">Forma de pagamento</h2>
          <button
            type="button"
            className="text-slate-400 transition hover:text-slate-700"
            aria-label="Fechar pagamento"
            onClick={onClose}
          >
            <X size={24} aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-5 p-6">
          <div className="flex items-center justify-between rounded-2xl bg-indigo-50 p-4">
            <span className="font-medium text-indigo-700">Total a pagar:</span>
            <span className="text-2xl font-black text-indigo-900">{formatBRL(total)}</span>
          </div>
          <PaymentActions
            disabled={disabled}
            cardSelectable={cardSelectable}
            pixSelectable={pixSelectable}
            onCash={onCash}
            onCard={onCard}
            onPix={onPix}
          />
        </div>
      </div>
    </div>
  );
}
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { formatBRL } from "@/lib/money";
import { resolveCashTender, suggestCashTenders } from "@/lib/domain/cash-tender";
import { PaymentActions } from "@/components/pdv/sale-summary";

type PaymentSheetProps = {
  open: boolean;
  total: string;
  disabled: boolean;
  online?: boolean;
  onCash: (amountReceived: string) => void;
  onCreditCard: () => void;
  onDebitCard: () => void;
  onPix: () => void;
  onTef: () => void;
  onClose: () => void;
};

export function PaymentSheet({
  open,
  total,
  disabled,
  online = true,
  onCash,
  onCreditCard,
  onDebitCard,
  onPix,
  onTef,
  onClose,
}: PaymentSheetProps) {
  const [amountReceived, setAmountReceived] = useState(total);
  const tender = useMemo(
    () => resolveCashTender(total, amountReceived),
    [amountReceived, total]
  );
  const suggestions = useMemo(() => suggestCashTenders(total), [total]);
  const electronicHint = online ? "não configurado" : "indisponível offline";

  useEffect(() => {
    if (open) setAmountReceived(total);
  }, [open, total]);

  if (!open) return null;

  return (
    <div data-testid="pdv-payment-sheet" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        aria-label="Fechar pagamento"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl">
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

          <div className="space-y-2 rounded-2xl border border-slate-200 p-4">
            <label className="block text-sm font-medium text-slate-700" htmlFor="cash-received">
              Valor recebido (dinheiro)
            </label>
            <input
              id="cash-received"
              data-testid="cash-received-input"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-lg font-semibold"
              value={amountReceived}
              onChange={(event) => setAmountReceived(event.target.value)}
              inputMode="decimal"
              disabled={disabled}
            />
            <div className="flex flex-wrap gap-2">
              {suggestions.map((value) => (
                <button
                  key={value}
                  type="button"
                  data-testid={`cash-tender-${value}`}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:border-indigo-300"
                  disabled={disabled}
                  onClick={() => setAmountReceived(value)}
                >
                  {formatBRL(value)}
                </button>
              ))}
            </div>
            <div
              data-testid="cash-change-due"
              className={`text-sm font-semibold ${tender.ok ? "text-emerald-700" : "text-amber-700"}`}
            >
              {tender.ok
                ? `Troco: ${formatBRL(tender.changeDue)}`
                : tender.error}
            </div>
          </div>

          <PaymentActions
            disabled={disabled}
            cashDisabled={disabled || !tender.ok}
            pixHint={electronicHint}
            cardHint={electronicHint}
            debitHint={electronicHint}
            tefHint={electronicHint}
            onCash={() => {
              if (!tender.ok) return;
              onCash(tender.amountReceived);
            }}
            onCreditCard={onCreditCard}
            onDebitCard={onDebitCard}
            onPix={onPix}
            onTef={onTef}
          />
        </div>
      </div>
    </div>
  );
}

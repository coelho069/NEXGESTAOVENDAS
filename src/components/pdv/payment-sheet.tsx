"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { formatBRL } from "@/lib/money";
import { resolveCashChange } from "@/lib/domain/cash-change";
import { PaymentActions } from "@/components/pdv/sale-summary";

type PaymentSheetProps = {
  open: boolean;
  total: string;
  disabled: boolean;
  cardSelectable?: boolean;
  onCash: () => void;
  onCard: () => void;
  onPixManual: () => void;
  onClose: () => void;
};

type CashStep = "methods" | "ask-change" | "received";

export function PaymentSheet({
  open,
  total,
  disabled,
  cardSelectable = false,
  onCash,
  onCard,
  onPixManual,
  onClose,
}: PaymentSheetProps) {
  const [cashStep, setCashStep] = useState<CashStep>("methods");
  const [receivedRaw, setReceivedRaw] = useState("");
  const [changeError, setChangeError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCashStep("methods");
      setReceivedRaw("");
      setChangeError(null);
    }
  }, [open]);

  const changePreview = useMemo(() => {
    if (cashStep !== "received" || !receivedRaw.trim()) return null;
    return resolveCashChange(total, receivedRaw);
  }, [cashStep, receivedRaw, total]);

  if (!open) return null;

  const backFromCashStep = () => {
    setChangeError(null);
    if (cashStep === "received") {
      setReceivedRaw("");
      setCashStep("ask-change");
      return;
    }
    setCashStep("methods");
  };

  const confirmCashWithChange = () => {
    const result = resolveCashChange(total, receivedRaw);
    if (!result.ok) {
      setChangeError(result.error);
      return;
    }
    setChangeError(null);
    // UX-only: charged amount remains cart total via existing onCash/pay("cash").
    onCash();
  };

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
          <h2 className="text-xl font-bold text-slate-900">
            {cashStep === "methods"
              ? "Forma de pagamento"
              : cashStep === "ask-change"
                ? "Troco"
                : "Valor recebido"}
          </h2>
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

          {cashStep === "methods" ? (
            <PaymentActions
              disabled={disabled}
              cardSelectable={cardSelectable}
              onCash={() => {
                setChangeError(null);
                setReceivedRaw("");
                setCashStep("ask-change");
              }}
              onCard={onCard}
              onPixManual={onPixManual}
            />
          ) : null}

          {cashStep === "ask-change" ? (
            <div className="space-y-3" data-testid="cash-change-ask">
              <p className="text-sm text-slate-600">Precisa de troco?</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  data-testid="cash-change-yes"
                  disabled={disabled}
                  onClick={() => {
                    setChangeError(null);
                    setCashStep("received");
                  }}
                  className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3 font-semibold text-emerald-900 transition hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Sim
                </button>
                <button
                  type="button"
                  data-testid="cash-change-no"
                  disabled={disabled}
                  onClick={() => onCash()}
                  className="rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 font-semibold text-slate-800 transition hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Não
                </button>
              </div>
              <button
                type="button"
                data-testid="cash-change-back"
                onClick={backFromCashStep}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-indigo-300"
              >
                Voltar
              </button>
            </div>
          ) : null}

          {cashStep === "received" ? (
            <div className="space-y-3" data-testid="cash-change-received">
              <label className="block text-sm font-medium text-slate-700" htmlFor="cash-received-input">
                Valor recebido
              </label>
              <input
                id="cash-received-input"
                data-testid="cash-received-input"
                inputMode="decimal"
                value={receivedRaw}
                onChange={(event) => {
                  setReceivedRaw(event.target.value);
                  setChangeError(null);
                }}
                placeholder="0,00"
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-lg font-semibold text-slate-900 outline-none focus:border-indigo-400"
              />
              {changePreview?.ok ? (
                <p data-testid="cash-change-amount" className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
                  Troco: {formatBRL(changePreview.change)}
                </p>
              ) : null}
              {changeError ? (
                <p role="alert" data-testid="cash-change-error" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
                  {changeError}
                </p>
              ) : null}
              <button
                type="button"
                data-testid="cash-change-confirm"
                disabled={disabled}
                onClick={confirmCashWithChange}
                className="w-full rounded-2xl bg-emerald-600 px-4 py-3 font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Confirmar dinheiro
              </button>
              <button
                type="button"
                data-testid="cash-change-back"
                onClick={backFromCashStep}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-indigo-300"
              >
                Voltar
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

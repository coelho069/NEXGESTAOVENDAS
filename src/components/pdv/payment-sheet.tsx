"use client";

import { useEffect, useMemo, useState } from "react";
import { Delete, X } from "lucide-react";
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

const NUMPAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", ","] as const;

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

  const appendNumpadKey = (key: string) => {
    setChangeError(null);
    if (key === ",") {
      setReceivedRaw((current) => (current.includes(",") ? current : current === "" ? "0," : `${current},`));
      return;
    }
    setReceivedRaw((current) => (current === "0" ? key : `${current}${key}`));
  };

  const backspaceNumpad = () => {
    setChangeError(null);
    setReceivedRaw((current) => current.slice(0, -1));
  };

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
    <div data-testid="pdv-payment-sheet" className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        aria-label="Fechar pagamento"
        onClick={onClose}
      />
      <div className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white p-6">
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
            <span className="text-2xl font-black text-indigo-900 tabular-nums">{formatBRL(total)}</span>
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
              <div
                data-testid="cash-numpad"
                className="grid grid-cols-3 gap-2"
                aria-label="Teclado numérico"
              >
                {NUMPAD_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    data-testid={key === "," ? "numpad-comma" : `numpad-${key}`}
                    disabled={disabled}
                    onClick={() => appendNumpadKey(key)}
                    className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-4 py-3 text-lg font-semibold text-slate-900 tabular-nums transition hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {key}
                  </button>
                ))}
                <button
                  type="button"
                  data-testid="numpad-back"
                  disabled={disabled}
                  onClick={backspaceNumpad}
                  aria-label="Apagar último dígito"
                  className="flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-700 transition hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Delete size={20} aria-hidden="true" />
                </button>
              </div>
              <button
                type="button"
                data-testid="cash-change-confirm"
                disabled={disabled}
                onClick={confirmCashWithChange}
                className="min-h-[44px] w-full rounded-2xl bg-emerald-600 px-4 py-3 font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
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

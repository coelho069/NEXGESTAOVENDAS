"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { formatBRL, money, subtractMoney, toMoneyString } from "@/lib/money";
import { PaymentActions } from "@/components/pdv/sale-summary";

type PaymentStep = "methods" | "ask-troco" | "enter-received";

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

function parseReceived(raw: string): string | null {
  const normalized = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized) return null;
  try {
    const value = money(normalized);
    if (!value.isFinite() || value.isNegative()) return null;
    return toMoneyString(value);
  } catch {
    return null;
  }
}

export function PaymentSheet({
  open,
  total,
  disabled,
  cardSelectable = false,
  onCash,
  onCard,
  onClose,
}: PaymentSheetProps) {
  const [step, setStep] = useState<PaymentStep>("methods");
  const [receivedRaw, setReceivedRaw] = useState("");

  useEffect(() => {
    if (!open) {
      setStep("methods");
      setReceivedRaw("");
    }
  }, [open]);

  const received = useMemo(() => parseReceived(receivedRaw), [receivedRaw]);
  const troco = useMemo(() => {
    if (received === null) return null;
    if (money(received).lt(money(total))) return null;
    return subtractMoney(received, total);
  }, [received, total]);
  const canConfirmReceived = received !== null && money(received).gte(money(total));

  if (!open) return null;

  const leaveTrocoStep = () => {
    setReceivedRaw("");
    setStep("methods");
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
            {step === "methods" ? "Forma de pagamento" : "Troco"}
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
            <span data-testid="payment-sheet-total" className="text-2xl font-black text-indigo-900">
              {formatBRL(total)}
            </span>
          </div>

          {step === "methods" ? (
            <PaymentActions
              disabled={disabled}
              cardSelectable={cardSelectable}
              pixSelectable={false}
              onCash={() => setStep("ask-troco")}
              onCard={onCard}
            />
          ) : null}

          {step === "ask-troco" ? (
            <div data-testid="troco-ask" className="space-y-4">
              <p className="text-center text-lg font-semibold text-slate-900">Precisa de troco?</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  data-testid="troco-yes"
                  disabled={disabled}
                  onClick={() => setStep("enter-received")}
                  className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3 font-semibold text-emerald-900 transition hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Sim
                </button>
                <button
                  type="button"
                  data-testid="troco-no"
                  disabled={disabled}
                  onClick={onCash}
                  className="rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 font-semibold text-slate-800 transition hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Não
                </button>
              </div>
              <button
                type="button"
                data-testid="troco-back"
                onClick={leaveTrocoStep}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-indigo-300"
              >
                Voltar
              </button>
            </div>
          ) : null}

          {step === "enter-received" ? (
            <div data-testid="troco-received" className="space-y-4">
              <label className="block text-sm font-medium text-slate-700" htmlFor="troco-received-input">
                Valor recebido
              </label>
              <input
                id="troco-received-input"
                data-testid="troco-received-input"
                type="text"
                inputMode="decimal"
                className="w-full rounded-xl border border-slate-300 px-3 py-3 text-lg tabular-nums"
                value={receivedRaw}
                disabled={disabled}
                placeholder="0,00"
                onChange={(event) => setReceivedRaw(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && canConfirmReceived && !disabled) {
                    onCash();
                  }
                }}
              />
              {received !== null && money(received).lt(money(total)) ? (
                <p data-testid="troco-insufficient" className="text-sm text-red-600">
                  Valor recebido deve ser maior ou igual ao total.
                </p>
              ) : null}
              {troco !== null ? (
                <div
                  data-testid="troco-amount"
                  className="flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3"
                >
                  <span className="font-medium text-emerald-800">Troco</span>
                  <span className="text-xl font-bold tabular-nums text-emerald-900">{formatBRL(troco)}</span>
                </div>
              ) : null}
              <p className="text-xs text-slate-500">
                O total cobrado permanece {formatBRL(total)}. Recebido e troco são só para conferência no caixa.
              </p>
              <button
                type="button"
                data-testid="troco-confirm"
                disabled={disabled || !canConfirmReceived}
                onClick={onCash}
                className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-lg font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                Confirmar dinheiro
              </button>
              <button
                type="button"
                data-testid="troco-back"
                onClick={() => {
                  setReceivedRaw("");
                  setStep("ask-troco");
                }}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-indigo-300"
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

"use client";

import { useEffect, useState } from "react";
import {
  MANUAL_PAYMENT_METHODS,
  MANUAL_PAYMENT_METHOD_LABELS,
  type ManualPaymentMethod,
} from "@/lib/domain/store-payment-methods";
import type { SaveAcceptedPaymentMethodsResult } from "@/hooks/use-store-payment-methods";

type Props = {
  accepted: ManualPaymentMethod[];
  onSave: (methods: ManualPaymentMethod[]) => Promise<SaveAcceptedPaymentMethodsResult>;
};

/** Marcação simples das formas aceitas. Sem integração: maquininha e PIX próprios. */
export function AcceptedPaymentMethodsSettings({ accepted, onSave }: Props) {
  const [selected, setSelected] = useState<ManualPaymentMethod[]>(accepted);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => setSelected(accepted), [accepted]);

  const toggle = (method: ManualPaymentMethod) => {
    setMessage(null);
    setSelected((current) =>
      current.includes(method) ? current.filter((item) => item !== method) : [...current, method]
    );
  };

  const save = async () => {
    if (selected.length === 0) {
      setMessage("Marque pelo menos uma forma de pagamento.");
      return;
    }
    setSaving(true);
    const result = await onSave(MANUAL_PAYMENT_METHODS.filter((method) => selected.includes(method)));
    setSaving(false);
    setMessage(result.ok ? "Formas de pagamento salvas." : "Não foi possível salvar. Tente de novo.");
  };

  return (
    <fieldset className="space-y-3 rounded-2xl border border-border p-4" data-testid="accepted-payment-methods">
      <legend className="px-1 text-sm font-semibold">Formas de pagamento aceitas</legend>
      <p className="text-xs text-muted-foreground">
        Marque o que a loja aceita. A cobrança é feita na sua maquininha ou no seu PIX; o sistema só registra a forma
        usada na venda.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {MANUAL_PAYMENT_METHODS.map((method) => (
          <label key={method} className="flex min-h-[44px] items-center gap-2 rounded-xl border border-border px-3">
            <input
              type="checkbox"
              data-testid={`accepted-method-${method}`}
              checked={selected.includes(method)}
              onChange={() => toggle(method)}
            />
            <span>{MANUAL_PAYMENT_METHOD_LABELS[method]}</span>
          </label>
        ))}
      </div>
      <button
        type="button"
        data-testid="accepted-methods-save"
        disabled={saving}
        onClick={() => void save()}
        className="min-h-[44px] w-full rounded-xl bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-50"
      >
        {saving ? "Salvando…" : "Salvar"}
      </button>
      {message ? <p role="status" className="text-sm">{message}</p> : null}
    </fieldset>
  );
}

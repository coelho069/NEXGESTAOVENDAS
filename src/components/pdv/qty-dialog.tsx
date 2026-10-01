"use client";

import { useEffect, useRef } from "react";
import { formatBRL } from "@/lib/money";

type QtyDialogProps = {
  open: boolean;
  productName: string | null;
  lineTotal: string;
  value: string;
  error: string | null;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
};

export function QtyDialog({
  open,
  productName,
  lineTotal,
  value,
  error,
  onChange,
  onConfirm,
  onClose,
}: QtyDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  if (!open) return null;

  return (
    <div data-testid="qty-dialog" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Fechar quantidade" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold">Editar quantidade (F4)</h2>
        <p className="mt-1 truncate text-sm text-slate-500">{productName ?? "Nenhum item selecionado"}</p>
        <input
          ref={inputRef}
          data-testid="qty-input"
          className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 tabular-nums"
          inputMode="numeric"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onConfirm();
          }}
        />
        {lineTotal ? (
          <p className="mt-2 text-sm text-slate-600 tabular-nums">Subtotal da linha: {formatBRL(lineTotal)}</p>
        ) : null}
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
        <button
          type="button"
          data-testid="qty-confirm"
          onClick={onConfirm}
          className="mt-4 min-h-[44px] w-full rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white transition hover:bg-indigo-700"
        >
          Confirmar
        </button>
      </div>
    </div>
  );
}

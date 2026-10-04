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
      <button type="button" className="pdv-modal-overlay" aria-label="Fechar quantidade" onClick={onClose} />
      <div className="pdv-modal-shell max-w-sm">
        <h2 className="text-lg font-semibold text-foreground">Editar quantidade (F4)</h2>
        <p className="mt-1 truncate text-sm text-muted-foreground">{productName ?? "Nenhum item selecionado"}</p>
        <input
          ref={inputRef}
          data-testid="qty-input"
          className="pdv-input mt-4 tabular-nums"
          inputMode="numeric"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onConfirm();
          }}
        />
        {lineTotal ? (
          <p className="mt-2 text-sm text-muted-foreground tabular-nums">Subtotal da linha: {formatBRL(lineTotal)}</p>
        ) : null}
        {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
        <button type="button" data-testid="qty-confirm" onClick={onConfirm} className="pdv-btn-primary mt-4 min-h-[44px] w-full">
          Confirmar
        </button>
      </div>
    </div>
  );
}

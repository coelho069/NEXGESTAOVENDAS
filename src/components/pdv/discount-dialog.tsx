type DiscountDialogProps = {
  open: boolean;
  value: string;
  max: string;
  subtotal?: string;
  role: string;
  error: string | null;
  onChange: (value: string) => void;
  onApply: () => void;
  onClose: () => void;
};

export function DiscountDialog({
  open,
  value,
  max,
  subtotal,
  role,
  error,
  onChange,
  onApply,
  onClose,
}: DiscountDialogProps) {
  if (!open) return null;

  return (
    <div data-testid="discount-dialog" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="pdv-modal-overlay" aria-label="Fechar desconto" onClick={onClose} />
      <div className="pdv-modal-shell max-w-sm">
        <h2 className="text-lg font-semibold text-foreground">Desconto (F6)</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Limite {role}: {max}
        </p>
        <div className="relative mt-4">
          <input
            data-testid="discount-input"
            className="pdv-input w-full pr-10"
            inputMode="decimal"
            placeholder="0"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onApply();
            }}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
        </div>
        {(() => {
          const pct = Number(value.replace("%", "").replace(",", "."));
          const sub = Number(subtotal ?? 0);
          if (!sub || !Number.isFinite(pct) || pct <= 0) return null;
          const amount = Math.floor((Math.round(sub * 100) * Math.round(pct * 100)) / 10000) / 100;
          return (
            <p className="mt-2 text-sm text-muted-foreground">
              = {amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} de desconto
            </p>
          );
        })()}
        {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
        <button type="button" data-testid="discount-apply" onClick={onApply} className="pdv-btn-success mt-4 w-full px-4 py-2">
          Aplicar
        </button>
      </div>
    </div>
  );
}

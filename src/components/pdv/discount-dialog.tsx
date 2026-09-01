type DiscountDialogProps = {
  open: boolean;
  value: string;
  max: string;
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
  role,
  error,
  onChange,
  onApply,
  onClose,
}: DiscountDialogProps) {
  if (!open) return null;

  return (
    <div data-testid="discount-dialog" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Fechar desconto" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold">Desconto (F6)</h2>
        <p className="mt-1 text-sm text-slate-500">
          Limite {role}: {max}
        </p>
        <input
          data-testid="discount-input"
          className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onApply();
          }}
        />
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
        <button
          type="button"
          data-testid="discount-apply"
          onClick={onApply}
          className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white"
        >
          Aplicar
        </button>
      </div>
    </div>
  );
}
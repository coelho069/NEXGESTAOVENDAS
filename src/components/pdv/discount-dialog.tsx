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
      <button type="button" className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" aria-label="Fechar desconto" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold tracking-tight">Desconto (F6)</h2>
        <p className="mt-1 text-sm text-slate-500">
          Limite {role}: {max}
        </p>
        <input
          data-testid="discount-input"
          className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 tabular-nums outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
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
          className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white outline-none transition hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-300"
        >
          Aplicar
        </button>
      </div>
    </div>
  );
}
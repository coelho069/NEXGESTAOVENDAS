"use client";

type CancelItemDialogProps = {
  open: boolean;
  productName: string | null;
  lineTotal: string;
  onConfirm: () => void;
  onClose: () => void;
};

/** F9 "Cancelar item": removal only happens after explicit confirmation. */
export function CancelItemDialog({
  open,
  productName,
  lineTotal,
  onConfirm,
  onClose,
}: CancelItemDialogProps) {
  if (!open) return null;

  return (
    <div
      data-testid="cancel-item-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        aria-label="Fechar confirmação"
        onClick={onClose}
      />
      <div className="relative w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold">Cancelar item (F9)</h2>
        <p className="mt-1 truncate text-sm text-slate-500">
          {productName ?? "Nenhum item selecionado"}
          {lineTotal ? <span className="tabular-nums"> · {lineTotal}</span> : null}
        </p>
        <p className="mt-2 text-sm text-slate-600">Remover o item selecionado do carrinho?</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            data-testid="cancel-item-cancel"
            onClick={onClose}
            className="min-h-[44px] rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700 transition hover:border-slate-400"
          >
            Manter item
          </button>
          <button
            type="button"
            data-testid="cancel-item-confirm"
            onClick={onConfirm}
            className="min-h-[44px] rounded-lg bg-red-600 px-4 py-2 font-semibold text-white transition hover:bg-red-700"
          >
            Remover
          </button>
        </div>
      </div>
    </div>
  );
}

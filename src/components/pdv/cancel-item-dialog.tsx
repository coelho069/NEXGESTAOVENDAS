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
    <div data-testid="cancel-item-dialog" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="pdv-modal-overlay" aria-label="Fechar confirmação" onClick={onClose} />
      <div className="pdv-modal-shell max-w-sm">
        <h2 className="text-lg font-semibold text-foreground">Cancelar item (F9)</h2>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          {productName ?? "Nenhum item selecionado"}
          {lineTotal ? <span className="tabular-nums"> · {lineTotal}</span> : null}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">Remover o item selecionado do carrinho?</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" data-testid="cancel-item-cancel" onClick={onClose} className="pdv-btn-ghost min-h-[44px]">
            Manter item
          </button>
          <button
            type="button"
            data-testid="cancel-item-confirm"
            onClick={onConfirm}
            className="min-h-[44px] rounded-lg bg-destructive px-4 py-2 font-semibold text-destructive-foreground transition hover:brightness-110"
          >
            Remover
          </button>
        </div>
      </div>
    </div>
  );
}

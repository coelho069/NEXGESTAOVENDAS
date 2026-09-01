import { renderReceiptHtml, type ReceiptModel } from "@/lib/domain/receipt";

type ReceiptDialogProps = {
  open: boolean;
  receipt: ReceiptModel | null;
  onClose: () => void;
};

export function ReceiptDialog({ open, receipt, onClose }: ReceiptDialogProps) {
  if (!open || !receipt) return null;
  const html = renderReceiptHtml(receipt);

  return (
    <div data-testid="receipt" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Fechar recibo" onClick={onClose} />
      <div className="relative flex h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Recibo</h2>
            <p data-testid="receipt-sync-status" className="text-sm text-slate-600">
              Sincronização: {receipt.syncStatus} · {receipt.saleStatus}
            </p>
          </div>
          <button type="button" className="text-sm text-slate-500" onClick={onClose}>
            Esc
          </button>
        </div>
        <iframe title="Recibo HTML" className="min-h-0 flex-1 rounded-lg border border-slate-200" srcDoc={html} />
      </div>
    </div>
  );
}
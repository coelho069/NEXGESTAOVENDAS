import { useState } from "react";
import { fiscalStatusLabel, renderReceiptHtml, type ReceiptModel } from "@/lib/domain/receipt";

type ReceiptDialogProps = {
  open: boolean;
  receipt: ReceiptModel | null;
  onClose: () => void;
  onReconcile?: () => Promise<unknown>;
};

export function ReceiptDialog({ open, receipt, onClose, onReconcile }: ReceiptDialogProps) {
  const [reconciling, setReconciling] = useState(false);
  if (!open || !receipt) return null;
  const html = renderReceiptHtml(receipt);
  const hasUnknownPayment = receipt.payments.some((payment) => payment.status === "unknown");

  return (
    <div data-testid="receipt" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        data-testid="receipt-close"
        className="absolute inset-0 bg-slate-900/40"
        aria-label="Fechar recibo"
        onClick={onClose}
      />
      <div className="relative flex h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Recibo</h2>
            <p data-testid="receipt-sync-status" className="text-sm text-slate-600">
              Sincronização: {receipt.syncStatus} · {receipt.saleStatus}
            </p>
            <p data-testid="receipt-fiscal-status" className="text-sm text-slate-600">
              Fiscal: {fiscalStatusLabel(receipt.fiscalStatus ?? "pending")}
            </p>
          </div>
          <button type="button" className="text-sm text-slate-500" onClick={onClose}>
            Esc
          </button>
        </div>
        {hasUnknownPayment ? (
          <div
            role="alert"
            data-testid="payment-unknown"
            className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          >
            <p className="font-semibold">Pagamento desconhecido</p>
            <p className="mt-1">
              Não sabemos se a cobrança foi concluída. A venda não foi confirmada; reconcilie antes de tentar novamente.
            </p>
            {onReconcile ? (
              <button
                type="button"
                data-testid="reconcile-payment"
                className="mt-3 rounded-lg bg-amber-700 px-3 py-2 font-medium text-white disabled:opacity-50"
                disabled={reconciling}
                onClick={async () => {
                  setReconciling(true);
                  try {
                    await onReconcile();
                  } finally {
                    setReconciling(false);
                  }
                }}
              >
                {reconciling ? "Reconciliando..." : "Reconciliar pagamento"}
              </button>
            ) : null}
          </div>
        ) : null}
        <iframe title="Recibo HTML" className="min-h-0 flex-1 rounded-lg border border-slate-200" srcDoc={html} />
      </div>
    </div>
  );
}
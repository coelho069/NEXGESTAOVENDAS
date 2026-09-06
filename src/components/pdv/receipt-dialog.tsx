import { useCallback, useEffect, useRef, useState } from "react";
import { formatBRL } from "@/lib/money";
import { commercialReceiptDisclaimer } from "@/lib/domain/fiscal";
import { fiscalStatusLabel, renderReceiptHtml, type ReceiptModel } from "@/lib/domain/receipt";
import {
  dispatchPrintJob,
  retryPrintJob,
} from "@/lib/adapters/printer";
import {
  isTerminalPrintFailure,
  normalizePaperWidthMm,
  normalizePrintMode,
  printFailureAffectsSaleLifecycle,
  printStatusLabel,
  type PaperWidthMm,
  type PrintJob,
  type PrintMode,
} from "@/lib/domain/printer";

type ReceiptDialogProps = {
  open: boolean;
  receipt: ReceiptModel | null;
  autoPrint?: boolean;
  printMode?: PrintMode;
  paperWidthMm?: PaperWidthMm;
  storeId?: string | null;
  orgId?: string | null;
  onClose: () => void;
  onReconcile?: () => Promise<unknown>;
};

export function ReceiptDialog({
  open,
  receipt,
  autoPrint = false,
  printMode = "browser",
  paperWidthMm = 80,
  storeId = null,
  orgId = null,
  onClose,
  onReconcile,
}: ReceiptDialogProps) {
  const [reconciling, setReconciling] = useState(false);
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  const [printing, setPrinting] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const autoPrintedRef = useRef<string | null>(null);

  const mode = normalizePrintMode(printMode);
  const width = normalizePaperWidthMm(paperWidthMm ?? receipt?.paperWidthMm);

  const runPrint = useCallback(
    async (options?: { retryFrom?: PrintJob | null; auto?: boolean }) => {
      if (!receipt) return null;
      // Invariant: print must never reverse sale / payment / stock.
      void printFailureAffectsSaleLifecycle();

      setPrinting(true);
      try {
        const browserPrint = () => {
          const frame = iframeRef.current;
          if (!frame?.contentWindow) {
            throw new Error("iframe de recibo indisponível");
          }
          frame.contentWindow.focus();
          frame.contentWindow.print();
        };

        const context = { browserPrint };
        const resolvedStoreId = storeId ?? "00000000-0000-4000-8000-000000000000";
        const resolvedOrgId = orgId ?? "00000000-0000-4000-8000-000000000000";

        const outcome = options?.retryFrom
          ? await retryPrintJob(options.retryFrom, receipt, context)
          : await dispatchPrintJob({
              saleId: receipt.saleId,
              storeId: resolvedStoreId,
              orgId: resolvedOrgId,
              mode,
              paperWidthMm: width,
              autoPrint: options?.auto,
              receipt,
              context,
            });

        setPrintJob(outcome.job);
        return outcome.job;
      } finally {
        setPrinting(false);
      }
    },
    [mode, orgId, receipt, storeId, width]
  );

  useEffect(() => {
    if (!open) {
      setPrintJob(null);
      return;
    }
    if (!receipt) return;
    if (!autoPrint) return;
    if (autoPrintedRef.current === receipt.saleId) return;

    const timer = window.setTimeout(() => {
      autoPrintedRef.current = receipt.saleId;
      void runPrint({ auto: true });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [autoPrint, open, receipt, runPrint]);

  if (!open || !receipt) return null;
  const html = renderReceiptHtml(receipt, { paperWidthMm: width });
  const hasUnknownPayment = receipt.payments.some((payment) => payment.status === "unknown");
  const showRetry = printJob ? isTerminalPrintFailure(printJob.status) || printJob.status === "print_dispatched" : false;

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
            <p data-testid="receipt-commercial-disclaimer" className="text-sm text-slate-500">
              {commercialReceiptDisclaimer(receipt.fiscalStatus)}
            </p>
            <p data-testid="receipt-fiscal-status" className="text-sm text-slate-600">
              Fiscal: {fiscalStatusLabel(receipt.fiscalStatus ?? "pending")}
              {receipt.fiscalStatus === "issued" ? "" : " (sem autorização fiscal)"}
            </p>
            <p data-testid="receipt-fiscal-qr" className="text-sm text-slate-500">
              {receipt.fiscalStatus === "issued" && receipt.fiscalAccessKey
                ? "QR fiscal disponível"
                : "QR Code fiscal indisponível"}
            </p>
            {receipt.changeDue ? (
              <p data-testid="receipt-change-label" className="text-sm font-medium text-emerald-700">
                Troco: {formatBRL(receipt.changeDue)}
              </p>
            ) : null}
            <p data-testid="receipt-print-status" className="text-xs text-slate-500">
              Impressão:{" "}
              {printJob
                ? `${printStatusLabel(printJob.status)} · tentativa #${printJob.attempt} · ${printJob.mode}`
                : "não solicitada"}
              {printJob?.message ? ` — ${printJob.message}` : ""}
            </p>
            <p data-testid="receipt-paper-width" className="text-xs text-slate-400">
              Papel {width}mm
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="receipt-print"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-indigo-400 disabled:opacity-50"
              disabled={printing}
              onClick={() => void runPrint()}
            >
              {printing ? "Imprimindo..." : "Imprimir"}
            </button>
            {showRetry ? (
              <button
                type="button"
                data-testid="receipt-print-retry"
                className="rounded-lg border border-amber-300 px-3 py-2 text-sm font-medium text-amber-800 hover:border-amber-500 disabled:opacity-50"
                disabled={printing || !printJob}
                onClick={() => void runPrint({ retryFrom: printJob })}
              >
                Retry
              </button>
            ) : null}
            <button
              type="button"
              data-testid="receipt-close"
              className="text-sm text-slate-500"
              onClick={onClose}
            >
              Esc
            </button>
          </div>
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
        {printJob && isTerminalPrintFailure(printJob.status) ? (
          <div
            role="status"
            data-testid="receipt-print-failure"
            className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
          >
            Falha de impressão não altera a venda, pagamento ou estoque. Você pode tentar novamente.
          </div>
        ) : null}
        <iframe
          ref={iframeRef}
          title="Recibo HTML"
          className="min-h-0 flex-1 rounded-lg border border-slate-200"
          srcDoc={html}
        />
      </div>
    </div>
  );
}

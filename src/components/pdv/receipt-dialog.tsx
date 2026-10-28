"use client";

import { useEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import {
  applyReceiptEdits,
  fiscalStatusLabel,
  paymentMethodLabel,
  paymentStatusLabel,
  renderReceiptHtml,
  type ReceiptModel,
  type ReceiptPayment,
} from "@/lib/domain/receipt";
import { parseMoneyInput } from "@/lib/domain/sale-ops";

const PAYMENT_METHOD_OPTIONS = [
  "cash",
  "pix",
  "debito",
  "credito",
  "pix_manual",
  "debito_manual",
  "credito_manual",
  "mercado_pago",
] as const;

const PAYMENT_STATUS_OPTIONS = [
  "pending",
  "authorized",
  "captured",
  "approved",
  "refunded",
  "cancelled",
  "failed",
] as const;

type ReceiptTab = "recibo" | "editar";

type ReceiptDialogProps = {
  open: boolean;
  receipt: ReceiptModel | null;
  onClose: () => void;
  onReconcile?: () => Promise<unknown>;
  onEdit?: (receipt: ReceiptModel) => void;
};

function optionValues(known: readonly string[], current: string): string[] {
  const list = Array.from(known);
  if (current && !list.includes(current)) list.push(current);
  return list;
}

export function ReceiptDialog({ open, receipt, onClose, onReconcile, onEdit }: ReceiptDialogProps) {
  const [reconciling, setReconciling] = useState(false);
  const [tab, setTab] = useState<ReceiptTab>("recibo");
  const [error, setError] = useState<string | null>(null);
  const [customerNameDraft, setCustomerNameDraft] = useState("");
  const [discountLimitDraft, setDiscountLimitDraft] = useState("");
  const [paymentsDraft, setPaymentsDraft] = useState<ReceiptPayment[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!open || !receipt) return;
    setTab("recibo");
    setError(null);
    setCustomerNameDraft(receipt.customerName ?? "");
    setDiscountLimitDraft(receipt.customerDiscountLimit ?? "");
    setPaymentsDraft(receipt.payments.map((payment) => ({ ...payment })));
  }, [open, receipt]);

  if (!open || !receipt) return null;
  const html = renderReceiptHtml(receipt);
  const hasUnknownPayment = receipt.payments.some((payment) => payment.status === "unknown");

  const handlePrint = () => {
    const iframe = iframeRef.current;
    if (iframe?.contentWindow) {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      return;
    }
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  const updatePayment = (index: number, patch: Partial<ReceiptPayment>) => {
    setPaymentsDraft((current) => current.map((payment, i) => (i === index ? { ...payment, ...patch } : payment)));
  };

  const resetDraft = () => {
    setError(null);
    setCustomerNameDraft(receipt.customerName ?? "");
    setDiscountLimitDraft(receipt.customerDiscountLimit ?? "");
    setPaymentsDraft(receipt.payments.map((payment) => ({ ...payment })));
  };

  const handleSave = () => {
    if (!onEdit) return;
    setError(null);

    const limitRaw = discountLimitDraft.trim();
    let customerDiscountLimit: string | null = null;
    if (limitRaw) {
      const parsed = parseMoneyInput(limitRaw);
      if (!parsed) {
        setError("Limite de desconto inválido.");
        return;
      }
      customerDiscountLimit = parsed;
    }

    const payments: ReceiptPayment[] = [];
    for (const payment of paymentsDraft) {
      const parsed = parseMoneyInput(payment.amount);
      if (!parsed) {
        setError(`Valor de pagamento inválido (${paymentMethodLabel(payment.method)}).`);
        return;
      }
      payments.push({ ...payment, amount: parsed });
    }

    onEdit(
      applyReceiptEdits(receipt, {
        customerName: customerNameDraft.trim() || null,
        customerDiscountLimit,
        payments,
      })
    );
    setTab("recibo");
  };

  const tabClass = (active: boolean): string =>
    `rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
      active
        ? "border-primary/50 bg-primary/10 text-foreground"
        : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
    }`;

  return (
    <div data-testid="receipt" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="pdv-modal-overlay" aria-label="Fechar recibo" onClick={onClose} />
      <div className="relative flex h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-card p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Recibo</h2>
            <p data-testid="receipt-fiscal-status" className="text-sm text-muted-foreground">
              Fiscal: {fiscalStatusLabel(receipt.fiscalStatus ?? "pending")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="receipt-print"
              className="pdv-btn-primary inline-flex items-center gap-2"
              onClick={handlePrint}
              aria-label="Imprimir recibo"
            >
              <Printer size={16} aria-hidden="true" />
              Imprimir
            </button>
            <button
              type="button"
              data-testid="receipt-close"
              className="relative z-10 text-sm text-muted-foreground"
              onClick={onClose}
            >
              Esc
            </button>
          </div>
        </div>

        <div role="tablist" aria-label="Seções do recibo" className="mb-3 flex gap-2">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "recibo"}
            data-testid="receipt-tab-recibo"
            className={tabClass(tab === "recibo")}
            onClick={() => setTab("recibo")}
          >
            Recibo
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "editar"}
            data-testid="receipt-tab-editar"
            className={tabClass(tab === "editar")}
            disabled={!onEdit}
            onClick={() => setTab("editar")}
          >
            Editar pagamento
          </button>
        </div>

        {hasUnknownPayment ? (
          <div
            role="alert"
            data-testid="payment-unknown"
            className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-amber-200"
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

        {tab === "recibo" ? (
          <iframe
            ref={iframeRef}
            title="Recibo HTML"
            className="min-h-0 flex-1 rounded-lg border border-border"
            srcDoc={html}
          />
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Cliente</h3>
              <label className="block text-sm text-muted-foreground">
                Nome do cliente
                <input
                  data-testid="receipt-edit-customer"
                  className="pdv-input mt-1"
                  value={customerNameDraft}
                  placeholder="Não informado"
                  onChange={(event) => setCustomerNameDraft(event.target.value)}
                />
              </label>
              <label className="block text-sm text-muted-foreground">
                Limite de desconto do cliente (opcional)
                <input
                  data-testid="receipt-edit-discount-limit"
                  className="pdv-input mt-1 tabular-nums"
                  inputMode="decimal"
                  value={discountLimitDraft}
                  placeholder="R$"
                  onChange={(event) => setDiscountLimitDraft(event.target.value)}
                />
              </label>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Pagamentos</h3>
              {paymentsDraft.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum pagamento registrado nesta venda.</p>
              ) : (
                paymentsDraft.map((payment, index) => (
                  <div key={index} className="rounded-xl border border-border p-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px_160px] sm:items-end">
                      <label className="block text-sm text-muted-foreground">
                        Forma
                        <select
                          data-testid={`receipt-edit-method-${index}`}
                          className="pdv-input mt-1"
                          value={payment.method}
                          onChange={(event) => updatePayment(index, { method: event.target.value })}
                        >
                          {optionValues(PAYMENT_METHOD_OPTIONS, payment.method).map((value) => (
                            <option key={value} value={value}>
                              {paymentMethodLabel(value)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-sm text-muted-foreground">
                        Valor
                        <input
                          data-testid={`receipt-edit-amount-${index}`}
                          className="pdv-input mt-1 tabular-nums"
                          inputMode="decimal"
                          value={payment.amount}
                          onChange={(event) => updatePayment(index, { amount: event.target.value })}
                        />
                      </label>
                      <label className="block text-sm text-muted-foreground">
                        Status
                        <select
                          data-testid={`receipt-edit-status-${index}`}
                          className="pdv-input mt-1"
                          value={payment.status}
                          onChange={(event) => updatePayment(index, { status: event.target.value })}
                        >
                          {optionValues(PAYMENT_STATUS_OPTIONS, payment.status).map((value) => (
                            <option key={value} value={value}>
                              {paymentStatusLabel(value)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                ))
              )}
            </section>

            {error ? (
              <p
                role="alert"
                data-testid="receipt-edit-error"
                className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-red-200"
              >
                {error}
              </p>
            ) : null}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                data-testid="receipt-edit-save"
                disabled={!onEdit}
                onClick={handleSave}
                className="pdv-btn-primary min-h-[44px] flex-1"
              >
                Salvar
              </button>
              <button
                type="button"
                data-testid="receipt-edit-cancel"
                onClick={() => {
                  resetDraft();
                  setTab("recibo");
                }}
                className="pdv-btn-ghost min-h-[44px] flex-1"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

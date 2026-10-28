import { formatBRL } from "@/lib/money";
import type { CartLine } from "@/lib/domain/sale";
import { lineTotal } from "@/lib/domain/sale";
import type { Enums } from "@/lib/db/types";

export type ReceiptPayment = {
  method: string;
  amount: string;
  status: string;
};

/** Campos editáveis do recibo de pagamento. Linha/valores da venda permanecem imutáveis. */
export type ReceiptEdits = {
  customerName: string | null;
  customerDiscountLimit: string | null;
  payments: ReceiptPayment[];
};

export type ReceiptModel = {
  saleId: string;
  clientMutationId?: string;
  storeName: string;
  createdAt: string;
  customerName: string | null;
  /** Limite de desconto cadastrado do cliente (R$), impresso no recibo. */
  customerDiscountLimit?: string | null;
  lines: CartLine[];
  subtotal: string;
  discount: string;
  total: string;
  payments: ReceiptPayment[];
  syncStatus: string;
  saleStatus: string;
  fiscalStatus?: Enums<"fiscal_document_status">;
};

export function fiscalStatusLabel(status: Enums<"fiscal_document_status">): string {
  switch (status) {
    case "issued":
      return "emitido";
    case "failed":
      return "falhou";
    case "cancelled":
      return "cancelado";
    case "not_configured":
      return "não configurado";
    case "unknown":
      return "desconhecido";
    case "pending":
      return "pendente";
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatSaoPauloDate(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(iso));
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  dinheiro: "Dinheiro", cash: "Dinheiro",
  debito_manual: "Débito (manual)", credito_manual: "Crédito (manual)", pix_manual: "Pix (manual)",
  debito: "Cartão de débito", credito: "Cartão de crédito", pix: "Pix",
  debit_card: "Cartão de débito", credit_card: "Cartão de crédito",
  mercado_pago: "Mercado Pago", voucher: "Vale", vale: "Vale",
};

export function paymentMethodLabel(method: string): string {
  const key = (method ?? "").toLowerCase();
  if (PAYMENT_METHOD_LABELS[key]) return PAYMENT_METHOD_LABELS[key];
  const t = key.replace(/_/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "—";
}

const PAYMENT_STATUS: Record<string, [string, string]> = {
  captured: ["Confirmado", "ok"], approved: ["Aprovado", "ok"], paid: ["Pago", "ok"],
  authorized: ["Autorizado", "warn"], pending: ["Pendente", "warn"], in_process: ["Em processamento", "warn"],
  refunded: ["Estornado", "bad"], cancelled: ["Cancelado", "bad"], canceled: ["Cancelado", "bad"],
  rejected: ["Recusado", "bad"], failed: ["Falhou", "bad"], voided: ["Anulado", "bad"],
};

export function paymentStatusLabel(status: string): string {
  return PAYMENT_STATUS[(status ?? "").toLowerCase()]?.[0] ?? status;
}

function paymentStatusTone(status: string): string {
  return PAYMENT_STATUS[(status ?? "").toLowerCase()]?.[1] ?? "neutral";
}

/**
 * Aplica edições do recibo de pagamento sobre o modelo base, preservando os
 * campos imutáveis da venda (linhas, subtotal, desconto, total, status de sync).
 */
export function applyReceiptEdits(base: ReceiptModel, edits: ReceiptEdits): ReceiptModel {
  return { ...base, ...edits };
}

export function renderReceiptHtml(model: ReceiptModel): string {
  const rows = model.lines
    .map((line) => {
      return `<tr>
        <td>${escapeHtml(line.sku)}</td>
        <td>${escapeHtml(line.name)}</td>
        <td>${escapeHtml(String(line.quantity))}</td>
        <td>${escapeHtml(formatBRL(line.unitPrice))}</td>
        <td>${escapeHtml(formatBRL(lineTotal(line)))}</td>
      </tr>`;
    })
    .join("");

  const payments = model.payments
    .map(
      (payment) =>
        `<div class="pay"><span class="pay-method">${escapeHtml(paymentMethodLabel(payment.method))}</span><span class="pay-amount">${escapeHtml(formatBRL(payment.amount))}</span><span class="pay-status st-${escapeHtml(paymentStatusTone(payment.status))}">${escapeHtml(paymentStatusLabel(payment.status))}</span></div>`
    )
    .join("");
  const fiscalStatus = model.fiscalStatus ?? "pending";

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Recibo ${escapeHtml(model.saleId)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; color: #0f172a; padding: 16px; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
    th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid #e2e8f0; }
    .muted { color: #64748b; font-size: 12px; }
    .total { font-size: 18px; font-weight: 700; margin-bottom: 12px; }
    .pay-title { font-size: 12px; font-weight: 600; text-transform: uppercase; color: #64748b; margin: 12px 0 4px; letter-spacing: .04em; }
    .pay { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 6px; font-size: 14px; }
    .pay-method { flex: 1; font-weight: 600; }
    .pay-amount { font-weight: 700; font-variant-numeric: tabular-nums; }
    .pay-status { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #f1f5f9; color: #475569; }
    .st-ok { background: #dcfce7; color: #166534; }
    .st-warn { background: #fef9c3; color: #854d0e; }
    .st-bad { background: #fee2e2; color: #991b1b; }
  </style>
</head>
<body>
  <h1>Nex Gestão Vendas — Recibo</h1>
  <div class="muted">${escapeHtml(model.storeName)} · ${escapeHtml(formatSaoPauloDate(model.createdAt))}</div>
  <div class="muted">Venda ${escapeHtml(model.saleId)}</div>
  <div class="muted">Cliente: ${escapeHtml(model.customerName ?? "Não informado")}</div>
  ${
    model.customerDiscountLimit
      ? `<div class="muted">Limite de desconto do cliente: até ${escapeHtml(formatBRL(model.customerDiscountLimit))}</div>`
      : ""
  }
  <table>
    <thead><tr><th>SKU</th><th>Item</th><th>Qtd</th><th>Unit.</th><th>Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div>Subtotal ${escapeHtml(formatBRL(model.subtotal))}</div>
  <div>Desconto ${escapeHtml(formatBRL(model.discount))}</div>
  <div class="total">Total ${escapeHtml(formatBRL(model.total))}</div>
  ${payments ? `<div class="pay-title">Pagamentos</div>${payments}` : ""}
  <div class="muted" data-receipt-fiscal="${escapeHtml(fiscalStatus)}">
    Fiscal: ${escapeHtml(fiscalStatusLabel(fiscalStatus))}
  </div>

</body>
</html>`;
}
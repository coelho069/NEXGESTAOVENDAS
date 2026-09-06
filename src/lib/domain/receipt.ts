import { formatBRL } from "@/lib/money";
import type { CartLine } from "@/lib/domain/sale";
import { lineTotal } from "@/lib/domain/sale";
import type { Enums } from "@/lib/db/types";
import {
  commercialReceiptDisclaimer,
  fiscalQrAvailability,
  type FiscalDocumentKind,
} from "@/lib/domain/fiscal";
import {
  normalizePaperWidthMm,
  type PaperWidthMm,
} from "@/lib/domain/printer";

export type ReceiptPayment = {
  method: string;
  amount: string;
  status: string;
};

export type ReceiptModel = {
  saleId: string;
  clientMutationId?: string;
  storeName: string;
  storeDocument?: string | null;
  storePhone?: string | null;
  storeAddress?: string | null;
  receiptFooter?: string | null;
  createdAt: string;
  customerName: string | null;
  operatorName?: string | null;
  lines: CartLine[];
  subtotal: string;
  discount: string;
  total: string;
  amountReceived?: string;
  changeDue?: string;
  payments: ReceiptPayment[];
  syncStatus: string;
  saleStatus: string;
  fiscalStatus?: Enums<"fiscal_document_status">;
  /** NFC-e / SAT kind when a fiscal document exists; never invents authorization. */
  fiscalKind?: FiscalDocumentKind | null;
  /** Access key only when status=issued from a real provider — never client-forged. */
  fiscalAccessKey?: string | null;
  fiscalProtocol?: string | null;
  documentKind?: "venda" | "cancelamento" | "devolucao";
  /** Thermal paper width preference (browser CSS). Defaults to 80mm. */
  paperWidthMm?: PaperWidthMm;
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

export function renderReceiptHtml(
  model: ReceiptModel,
  options?: { paperWidthMm?: PaperWidthMm }
): string {
  const paperWidthMm = normalizePaperWidthMm(options?.paperWidthMm ?? model.paperWidthMm ?? 80);
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
        `<div>${escapeHtml(payment.method)} · ${escapeHtml(formatBRL(payment.amount))} · ${escapeHtml(payment.status)}</div>`
    )
    .join("");
  const fiscalStatus = model.fiscalStatus ?? "pending";
  const qr = fiscalQrAvailability({
    status: fiscalStatus,
    accessKey: model.fiscalAccessKey,
    protocol: model.fiscalProtocol,
  });
  const commercialDisclaimer = commercialReceiptDisclaimer(fiscalStatus);

  const commercialBits = [
    model.storeDocument ? `Doc. ${model.storeDocument}` : null,
    model.storePhone ? `Tel. ${model.storePhone}` : null,
    model.storeAddress ?? null,
  ]
    .filter(Boolean)
    .map((value) => `<div class="muted">${escapeHtml(String(value))}</div>`)
    .join("");
  const footer = model.receiptFooter
    ? `<div class="muted" data-receipt-footer>${escapeHtml(model.receiptFooter)}</div>`
    : "";

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Recibo ${escapeHtml(model.saleId)}</title>
  <style>
    @page { size: ${paperWidthMm}mm auto; margin: 2mm; }
    body {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      color: #0f172a;
      padding: 8px;
      margin: 0 auto;
      width: ${paperWidthMm}mm;
      max-width: ${paperWidthMm}mm;
      box-sizing: border-box;
      word-wrap: break-word;
      overflow-wrap: anywhere;
    }
    h1 { font-size: ${paperWidthMm === 58 ? "13px" : "16px"}; margin: 0 0 8px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: ${paperWidthMm === 58 ? "10px" : "12px"}; }
    th, td { text-align: left; padding: 4px 2px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    .muted { color: #64748b; font-size: ${paperWidthMm === 58 ? "10px" : "11px"}; }
    .total { font-size: ${paperWidthMm === 58 ? "14px" : "16px"}; font-weight: 700; }
    .sync { margin-top: 12px; padding: 8px 10px; background: #ecfdf5; border: 1px solid #a7f3d0; }
    @media print {
      body { width: ${paperWidthMm}mm; max-width: ${paperWidthMm}mm; }
    }
  </style>
</head>
<body data-receipt-paper-width="${paperWidthMm}">
  <h1>Nex Gestão Vendas — ${escapeHtml(
    model.documentKind === "cancelamento"
      ? "CANCELAMENTO"
      : model.documentKind === "devolucao"
        ? "DEVOLUÇÃO"
        : "Comprovante comercial"
  )}</h1>
  <div class="muted">${escapeHtml(model.storeName)} · ${escapeHtml(formatSaoPauloDate(model.createdAt))}</div>
  ${commercialBits}
  <div class="muted">Venda ${escapeHtml(model.saleId)}</div>
  <div class="muted">Operador: ${escapeHtml(model.operatorName ?? "Não informado")}</div>
  <div class="muted">Cliente: ${escapeHtml(model.customerName ?? "Não informado")}</div>
  <table>
    <thead><tr><th>SKU</th><th>Item</th><th>Qtd</th><th>Unit.</th><th>Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div>Subtotal ${escapeHtml(formatBRL(model.subtotal))}</div>
  <div>Desconto ${escapeHtml(formatBRL(model.discount))}</div>
  <div class="total">Total ${escapeHtml(formatBRL(model.total))}</div>
  ${payments}
  ${
    model.amountReceived
      ? `<div data-receipt-received>Recebido ${escapeHtml(formatBRL(model.amountReceived))}</div>`
      : ""
  }
  ${
    model.changeDue
      ? `<div data-receipt-change>Troco ${escapeHtml(formatBRL(model.changeDue))}</div>`
      : ""
  }
  <div class="muted" data-receipt-kind="commercial">${escapeHtml(commercialDisclaimer)}</div>
  <div class="muted" data-receipt-fiscal="${escapeHtml(fiscalStatus)}">
    Fiscal: ${escapeHtml(fiscalStatusLabel(fiscalStatus))}
    ${model.fiscalKind ? ` · ${escapeHtml(model.fiscalKind.toUpperCase())}` : ""}
  </div>
  <div class="muted" data-receipt-fiscal-qr="${qr.available ? "available" : "unavailable"}">
    ${
      qr.available
        ? `QR fiscal: chave ${escapeHtml(qr.accessKey)}`
        : escapeHtml(qr.reason)
    }
  </div>
  <div class="sync" data-receipt-sync="${escapeHtml(model.syncStatus)}">
    Status da venda: ${escapeHtml(model.saleStatus)} · Sincronização: ${escapeHtml(model.syncStatus)}
  </div>
  ${footer}
</body>
</html>`;
}
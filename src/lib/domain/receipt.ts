import { formatBRL } from "@/lib/money";
import type { CartLine } from "@/lib/domain/sale";
import { lineTotal } from "@/lib/domain/sale";

export type ReceiptPayment = {
  method: string;
  amount: string;
  status: string;
};

export type ReceiptModel = {
  saleId: string;
  storeName: string;
  createdAt: string;
  customerName: string | null;
  lines: CartLine[];
  subtotal: string;
  discount: string;
  total: string;
  payments: ReceiptPayment[];
  syncStatus: string;
  saleStatus: string;
};

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
        `<div>${escapeHtml(payment.method)} · ${escapeHtml(formatBRL(payment.amount))} · ${escapeHtml(payment.status)}</div>`
    )
    .join("");

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
    .total { font-size: 18px; font-weight: 700; }
    .sync { margin-top: 12px; padding: 8px 10px; background: #ecfdf5; border: 1px solid #a7f3d0; }
  </style>
</head>
<body>
  <h1>Nex Gestão Vendas — Recibo</h1>
  <div class="muted">${escapeHtml(model.storeName)} · ${escapeHtml(formatSaoPauloDate(model.createdAt))}</div>
  <div class="muted">Venda ${escapeHtml(model.saleId)}</div>
  <div class="muted">Cliente: ${escapeHtml(model.customerName ?? "Não informado")}</div>
  <table>
    <thead><tr><th>SKU</th><th>Item</th><th>Qtd</th><th>Unit.</th><th>Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div>Subtotal ${escapeHtml(formatBRL(model.subtotal))}</div>
  <div>Desconto ${escapeHtml(formatBRL(model.discount))}</div>
  <div class="total">Total ${escapeHtml(formatBRL(model.total))}</div>
  ${payments}
  <div class="sync" data-receipt-sync="${escapeHtml(model.syncStatus)}">
    Status da venda: ${escapeHtml(model.saleStatus)} · Sincronização: ${escapeHtml(model.syncStatus)}
  </div>
</body>
</html>`;
}
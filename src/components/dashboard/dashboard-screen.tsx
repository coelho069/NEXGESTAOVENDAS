"use client";

import type { ReactNode } from "react";
import { ChevronRight, Download, Filter, Package } from "lucide-react";
import { formatBRL } from "@/lib/money";
import { PermissionGate } from "@/components/auth/permission-gate";
import { StoreSelect } from "@/components/auth/store-select";
import { Button, buttonClassName } from "@/components/ui/button";
import type { PaymentAdapterAlert } from "@/lib/adapters/payment";
import type { MemberRole } from "@/lib/domain/rbac";
import { paymentMethodLabel, saleStatusLabel } from "@/lib/domain/sale-history";
import type { DashboardLoadResult } from "@/lib/server/dashboard-query";

type DashboardScreenProps = {
  storeId: string | null;
  initial: DashboardLoadResult;
  paymentAlerts: PaymentAdapterAlert[];
};

const fieldClassName =
  "mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

export function DashboardScreen({ storeId, initial, paymentAlerts }: DashboardScreenProps) {
  const summary = initial.payload.summary;
  const nextHref = storeId && initial.payload.next_cursor
    ? `/dashboard?store=${storeId}&from=${initial.payload.from}&to=${initial.payload.to}&cursor=${encodeURIComponent(initial.payload.next_cursor)}`
    : null;
  const exportHref = storeId && !initial.degraded
    ? `/api/dashboard/export?store_id=${encodeURIComponent(storeId)}&from=${initial.payload.from}&to=${initial.payload.to}&limit=100`
    : null;
  const inventoryHref = storeId ? `/inventory?store=${encodeURIComponent(storeId)}` : "/inventory";
  const excludedSalesEntries = sortedCountEntries(summary.excludedSales);
  const excludedPaymentsEntries = sortedCountEntries(summary.excludedPayments);
  const excludedSalesTotal = sumCounts(summary.excludedSales);
  const excludedPaymentsTotal = sumCounts(summary.excludedPayments);
  const criticalRows = initial.payload.rows.filter((row) => row.on_hand <= 0);
  const notConfiguredAlerts = paymentAlerts.filter((alert) => isNotConfiguredAlert(alert));
  const unknownAlerts = paymentAlerts.filter((alert) => isUnknownAlert(alert));
  const unknownFromPayload = hasUnknownPayloadStatus(summary.excludedSales, summary.excludedPayments);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-7 p-4 lg:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">
              {initial.payload.from} → {initial.payload.to}
            </span>
            <span className="ml-2">(fim exclusivo) · America/Sao_Paulo</span>
          </p>
        </div>
        <span
          data-testid="dashboard-role"
          className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600"
        >
          Papel: {roleLabel(initial.role)}
        </span>
      </header>

      <form
        method="get"
        action="/dashboard"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
      >
        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Loja
          <StoreSelect
            name="store"
            testId="dashboard-store"
            className={fieldClassName}
            stores={initial.stores}
            defaultValue={storeId}
          />
        </label>
        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
          De
          <input
            type="date"
            name="from"
            data-testid="dashboard-from"
            defaultValue={initial.payload.from}
            className={fieldClassName}
          />
        </label>
        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Até
          <input
            type="date"
            name="to"
            data-testid="dashboard-to"
            defaultValue={initial.payload.to}
            className={fieldClassName}
          />
        </label>
        <Button type="submit" data-testid="dashboard-filter" className="px-4">
          <Filter size={15} aria-hidden="true" />
          Filtrar
        </Button>
      </form>

      {initial.degraded ? (
        <div data-testid="dashboard-degraded" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
          {initial.message ?? "Estado degradado"}
        </div>
      ) : null}

      {initial.forbidden && !initial.degraded ? (
        <div data-testid="dashboard-forbidden" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
          {initial.message ?? "Acesso à loja negado."}
        </div>
      ) : null}

      <PermissionGate role={initial.role} allow={["admin", "manager"]}>
        <AlertStrip
          notConfiguredAlerts={notConfiguredAlerts}
          unknownAlerts={unknownAlerts}
          unknownFromPayload={unknownFromPayload}
          excludedSalesTotal={excludedSalesTotal}
          excludedPaymentsTotal={excludedPaymentsTotal}
        />
        {initial.degraded ? (
          <div
            data-testid="dashboard-online-only"
            className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
          >
            Indicadores financeiros oficiais ficam indisponíveis sem uma resposta
            online completa do servidor.
          </div>
        ) : (
          <>
            <div data-testid="dashboard-metrics" className="flex flex-col gap-6">
              <section className="space-y-3">
                <SectionHeading>Resumo</SectionHeading>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Metric
                    dataTestId="dashboard-revenue"
                    label="Faturamento confirmado"
                    value={formatBRL(summary.revenue)}
                    emphasis
                  />
                  <Metric
                    dataTestId="dashboard-average-ticket"
                    label="Ticket médio"
                    value={formatOptionalBRL(summary.averageTicket)}
                    emphasis
                  />
                  <Metric
                    dataTestId="dashboard-sales-count"
                    label="Vendas confirmadas"
                    value={String(summary.salesCount)}
                    emphasis
                  />
                </div>
              </section>
              <section className="space-y-3">
                <SectionHeading>Rentabilidade e volume</SectionHeading>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric dataTestId="dashboard-discounts" label="Descontos persistidos" value={formatBRL(summary.totalDiscounts)} />
                  <Metric label="COGS histórico" value={formatOptionalBRL(summary.cogs)} />
                  <Metric label="Margem bruta" value={formatOptionalPercent(summary.marginPercent)} />
                  <Metric label="Unidades vendidas" value={formatQuantity(summary.unitsSold)} />
                  <Metric label="Sell-through vs. saldo atual" value={formatOptionalPercent(summary.sellThrough)} />
                </div>
              </section>
            </div>

            <section className="space-y-3">
              <SectionHeading>Operação e estoque</SectionHeading>
              <div className="grid gap-4 lg:grid-cols-3">
                <SummaryCard title="Pagamentos capturados" testId="dashboard-payments">
                  {Object.entries(summary.paymentsByMethod).map(([method, amount]) => (
                    <SummaryLine
                      key={method}
                      label={`${paymentMethodLabel(method)} (${summary.paymentCountsByMethod[method as keyof typeof summary.paymentCountsByMethod] ?? 0})`}
                      value={formatBRL(amount)}
                    />
                  ))}
                </SummaryCard>
                <SummaryCard title="Caixa físico" testId="dashboard-cash">
                  <SummaryLine label="Entradas cash capturadas" value={formatBRL(summary.cash.capturedCashPayments)} />
                  <SummaryLine label="Movimentos de venda" value={formatBRL(summary.cash.cashLedgerSales)} />
                  <SummaryLine label="Saldo líquido ledger" value={formatBRL(summary.cash.cashLedgerNet)} />
                  <SummaryLine label="Caixas abertos" value={String(summary.cash.openSessions)} />
                  <SummaryLine label="Diferença fechada" value={formatBRL(summary.cash.closedDifference)} />
                </SummaryCard>
                <SummaryCard title="Estoque persistido" testId="dashboard-inventory">
                  <SummaryLine label="Quantidade em mãos" value={summary.inventory.onHandQuantity} />
                  <SummaryLine label="SKUs" value={String(summary.inventory.skuCount)} />
                  <SummaryLine label="Linhas negativas" value={String(summary.inventory.negativeQuantityRows)} />
                  <SummaryLine label="Base de margem" value={summary.cogsAvailable ? "Snapshot histórico" : "N/D"} />
                </SummaryCard>
              </div>
            </section>

            <section className="space-y-3">
              <SectionHeading>Exceções</SectionHeading>
              <div className="grid gap-4 lg:grid-cols-2">
                <SummaryCard
                  title="Canceladas / estornadas"
                  testId="dashboard-excluded"
                  hint="Fora do faturamento confirmado no período"
                >
                  <SummaryLine label="Vendas excluídas" value={String(excludedSalesTotal)} />
                  {excludedSalesEntries.length === 0 ? (
                    <p className="text-sm text-slate-500">Nenhuma venda excluída no período.</p>
                  ) : (
                    excludedSalesEntries.map(([status, count]) => (
                      <SummaryLine key={`sale-${status}`} label={excludedSaleStatusLabel(status)} value={String(count)} />
                    ))
                  )}
                  <SummaryLine label="Pagamentos excluídos" value={String(excludedPaymentsTotal)} />
                  {excludedPaymentsEntries.length === 0 ? (
                    <p className="text-sm text-slate-500">Nenhum pagamento excluído no período.</p>
                  ) : (
                    excludedPaymentsEntries.map(([status, count]) => (
                      <SummaryLine
                        key={`payment-${status}`}
                        label={excludedPaymentStatusLabel(status)}
                        value={String(count)}
                      />
                    ))
                  )}
                </SummaryCard>

                <SummaryCard
                  title="Estoque crítico"
                  testId="dashboard-critical-stock"
                  hint="SKUs da página atual com saldo ≤ 0"
                >
                  <SummaryLine
                    label="Linhas negativas (loja)"
                    value={String(summary.inventory.negativeQuantityRows)}
                  />
                  {criticalRows.length === 0 ? (
                    <p className="text-sm text-slate-500">Nenhum SKU da página atual com saldo ≤ 0.</p>
                  ) : (
                    criticalRows.map((row) => (
                      <SummaryLine
                        key={row.product_id}
                        label={row.product_name ? `${row.sku} · ${row.product_name}` : row.sku}
                        value={formatQuantity(row.on_hand)}
                      />
                    ))
                  )}
                  <a
                    data-testid="dashboard-inventory-link"
                    href={inventoryHref}
                    className={`${buttonClassName("secondary")} mt-2 w-fit`}
                  >
                    <Package size={15} aria-hidden="true" />
                    Abrir inventário
                  </a>
                </SummaryCard>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SectionHeading>Detalhe por SKU</SectionHeading>
                <div className="flex flex-wrap items-center gap-2">
                  {exportHref ? (
                    <a
                      data-testid="dashboard-export"
                      href={exportHref}
                      className={buttonClassName("primary")}
                    >
                      <Download size={15} aria-hidden="true" />
                      Exportar página CSV
                    </a>
                  ) : null}
                  {nextHref ? (
                    <a data-testid="dashboard-next" href={nextHref} className={buttonClassName("secondary")}>
                      Próxima página
                      <ChevronRight size={15} aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">SKU</th>
                      <th className="px-4 py-2.5 font-semibold">Faturamento</th>
                      <th className="px-4 py-2.5 font-semibold">Descontos</th>
                      <th className="px-4 py-2.5 font-semibold">COGS</th>
                      <th className="px-4 py-2.5 font-semibold">Lucro</th>
                      <th className="px-4 py-2.5 font-semibold">Sell-through</th>
                    </tr>
                  </thead>
                  <tbody>
                    {initial.payload.rows.length === 0 ? (
                      <tr>
                        <td className="px-4 py-5 text-slate-500" colSpan={6}>
                          Sem vendas no período.
                        </td>
                      </tr>
                    ) : (
                      initial.payload.rows.map((row) => (
                        <tr
                          key={row.product_id}
                          className="border-t border-slate-100 transition-colors hover:bg-slate-50"
                        >
                          <td className="px-4 py-2.5 font-medium text-slate-800">{row.sku}</td>
                          <td className="px-4 py-2.5 tabular-nums">{formatBRL(row.revenue)}</td>
                          <td className="px-4 py-2.5 tabular-nums">{formatBRL(row.discounts)}</td>
                          <td className="px-4 py-2.5 tabular-nums">{formatOptionalBRL(row.cogs)}</td>
                          <td className="px-4 py-2.5 tabular-nums">{formatOptionalBRL(row.gross_profit)}</td>
                          <td className="px-4 py-2.5 tabular-nums">{formatOptionalPercent(row.sell_through)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </PermissionGate>
    </div>
  );
}

function roleLabel(role: MemberRole | null): string {
  if (role === "admin") return "Admin";
  if (role === "manager") return "Gerente";
  if (role === "cashier") return "Caixa";
  return "Não disponível";
}

function formatOptionalBRL(value: string | null): string {
  return value === null ? "N/D" : formatBRL(value);
}

function formatOptionalPercent(value: string | null): string {
  return value === null ? "N/D" : `${value}%`;
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
      <span className="h-3.5 w-0.5 rounded-full bg-emerald-500" aria-hidden="true" />
      {children}
    </h2>
  );
}

function Metric({
  dataTestId,
  label,
  value,
  emphasis = false,
}: {
  dataTestId?: string;
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      data-testid={dataTestId}
      className={
        emphasis
          ? "rounded-xl border border-emerald-100 bg-white px-5 py-4 shadow-sm transition-all duration-200 hover:-translate-y-px hover:border-emerald-200 hover:shadow-md"
          : "rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition-all duration-200 hover:-translate-y-px hover:border-slate-300 hover:shadow-md"
      }
    >
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div
        className={
          emphasis
            ? "mt-2 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums"
            : "mt-1.5 text-lg font-semibold text-slate-800 tabular-nums"
        }
      >
        {value}
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  testId,
  hint,
  children,
}: {
  title: string;
  testId: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section
      data-testid={testId}
      className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition-all duration-200 hover:-translate-y-px hover:border-slate-300 hover:shadow-md"
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-slate-600">{label}</span>
      <strong className="tabular-nums text-slate-900">{value}</strong>
    </div>
  );
}

function AlertStrip({
  notConfiguredAlerts,
  unknownAlerts,
  unknownFromPayload,
  excludedSalesTotal,
  excludedPaymentsTotal,
}: {
  notConfiguredAlerts: PaymentAdapterAlert[];
  unknownAlerts: PaymentAdapterAlert[];
  unknownFromPayload: boolean;
  excludedSalesTotal: number;
  excludedPaymentsTotal: number;
}) {
  const lines: string[] = [];
  if (notConfiguredAlerts.length > 0) {
    const methods = notConfiguredAlerts.map((alert) => paymentMethodLabel(alert.method)).join(", ");
    lines.push(`${methods}: not_configured. Apenas dinheiro é processado no MVP.`);
  }
  if (unknownAlerts.length > 0) {
    const methods = unknownAlerts.map((alert) => paymentMethodLabel(alert.method)).join(", ");
    lines.push(`${methods}: status unknown no adapter.`);
  }
  if (unknownFromPayload) {
    lines.push("Há vendas ou pagamentos com status unknown no período.");
  }
  if (excludedSalesTotal > 0 || excludedPaymentsTotal > 0) {
    lines.push(
      `${excludedSalesTotal} venda(s) e ${excludedPaymentsTotal} pagamento(s) ficaram de fora do faturamento confirmado.`
    );
  }
  if (lines.length === 0) return null;

  return (
    <div
      role="status"
      data-testid="dashboard-alerts"
      className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Alertas</p>
      <div className="mt-1.5 space-y-1">
        {lines.map((line, index) => (
          <p key={line} className={index === 0 ? "font-medium" : undefined}>
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

function sortedCountEntries(record: Record<string, number>): Array<[string, number]> {
  return Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
}

function sumCounts(record: Record<string, number>): number {
  return Object.values(record).reduce((total, count) => total + count, 0);
}

function isNotConfiguredAlert(alert: PaymentAdapterAlert): boolean {
  return alert.adapterStatus === "not_configured" || alert.operationStatus === "not_configured";
}

function isUnknownAlert(alert: PaymentAdapterAlert): boolean {
  return alert.operationStatus === "unknown";
}

function hasUnknownPayloadStatus(
  excludedSales: Record<string, number>,
  excludedPayments: Record<string, number>
): boolean {
  return [...Object.entries(excludedSales), ...Object.entries(excludedPayments)].some(
    ([status, count]) => count > 0 && (status === "unknown" || status === "payment_unknown")
  );
}

function excludedSaleStatusLabel(status: string): string {
  if (status.startsWith("payment_")) {
    const paymentStatus = status.slice("payment_".length);
    return `Confirmada · pagamento ${paymentStatusLabel(paymentStatus)}`;
  }
  return saleStatusLabel(status);
}

function excludedPaymentStatusLabel(status: string): string {
  return `Pagamento ${paymentStatusLabel(status)}`;
}

function paymentStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "pendente";
    case "authorized":
      return "autorizado";
    case "captured":
      return "capturado";
    case "failed":
      return "falhou";
    case "unknown":
      return "unknown";
    case "cancelled":
      return "cancelado";
    case "refunded":
      return "estornado";
    case "missing":
      return "ausente";
    case "not_configured":
      return "not_configured";
    default:
      return status;
  }
}

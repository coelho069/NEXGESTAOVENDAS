"use client";

import type { ReactNode } from "react";
import { formatBRL } from "@/lib/money";
import { PermissionGate } from "@/components/auth/permission-gate";
import type { MemberRole } from "@/lib/domain/rbac";
import type { DashboardLoadResult } from "@/lib/server/dashboard-query";

type DashboardScreenProps = {
  storeId: string | null;
  initial: DashboardLoadResult;
};

export function DashboardScreen({ storeId, initial }: DashboardScreenProps) {
  const summary = initial.payload.summary;
  const nextHref = storeId && initial.payload.next_cursor
    ? `/dashboard?store=${storeId}&from=${initial.payload.from}&to=${initial.payload.to}&cursor=${encodeURIComponent(initial.payload.next_cursor)}`
    : null;
  const exportHref = storeId && !initial.degraded
    ? `/api/dashboard/export?store_id=${encodeURIComponent(storeId)}&from=${initial.payload.from}&to=${initial.payload.to}&limit=100`
    : null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-slate-500">
            {initial.payload.from} → {initial.payload.to} (fim exclusivo) · timezone America/Sao_Paulo
          </p>
        </div>
        <span data-testid="dashboard-role" className="text-sm text-slate-500">
          Papel: {roleLabel(initial.role)}
        </span>
      </div>

      <form method="get" action="/dashboard" className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <label className="text-sm">
          Loja
          <select
            name="store"
            data-testid="dashboard-store"
            className="mt-1 block rounded border border-slate-300 px-2 py-1"
            defaultValue={storeId ?? ""}
          >
            <option value="">Selecione...</option>
            {initial.stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          De
          <input
            type="date"
            name="from"
            data-testid="dashboard-from"
            defaultValue={initial.payload.from}
            className="mt-1 block rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <label className="text-sm">
          Até
          <input
            type="date"
            name="to"
            data-testid="dashboard-to"
            defaultValue={initial.payload.to}
            className="mt-1 block rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <button
          type="submit"
          data-testid="dashboard-filter"
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
        >
          Filtrar
        </button>
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
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="dashboard-metrics">
              <Metric dataTestId="dashboard-revenue" label="Faturamento confirmado" value={formatBRL(summary.revenue)} />
              <Metric dataTestId="dashboard-sales-count" label="Vendas confirmadas" value={String(summary.salesCount)} />
              <Metric dataTestId="dashboard-average-ticket" label="Ticket médio" value={formatOptionalBRL(summary.averageTicket)} />
              <Metric dataTestId="dashboard-discounts" label="Descontos persistidos" value={formatBRL(summary.totalDiscounts)} />
              <Metric label="COGS histórico" value={formatOptionalBRL(summary.cogs)} />
              <Metric label="Margem bruta" value={formatOptionalPercent(summary.marginPercent)} />
              <Metric label="Unidades vendidas" value={formatQuantity(summary.unitsSold)} />
              <Metric label="Sell-through vs. saldo atual" value={formatOptionalPercent(summary.sellThrough)} />
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              <SummaryCard title="Pagamentos capturados" testId="dashboard-payments">
                {Object.entries(summary.paymentsByMethod).map(([method, amount]) => (
                  <SummaryLine
                    key={method}
                    label={`${method} (${summary.paymentCountsByMethod[method as keyof typeof summary.paymentCountsByMethod] ?? 0})`}
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

            <div className="flex flex-wrap items-center gap-3 text-sm">
              {exportHref ? (
                <a
                  data-testid="dashboard-export"
                  href={exportHref}
                  className="font-medium text-emerald-700"
                >
                  Exportar página CSV
                </a>
              ) : null}
              {nextHref ? (
                <a data-testid="dashboard-next" href={nextHref} className="font-medium text-emerald-700">
                  Próxima página
                </a>
              ) : null}
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Faturamento</th>
                    <th className="px-3 py-2">Descontos</th>
                    <th className="px-3 py-2">COGS</th>
                    <th className="px-3 py-2">Lucro</th>
                    <th className="px-3 py-2">Sell-through</th>
                  </tr>
                </thead>
                <tbody>
                  {initial.payload.rows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-4 text-slate-500" colSpan={6}>
                        Sem vendas no período.
                      </td>
                    </tr>
                  ) : (
                    initial.payload.rows.map((row) => (
                      <tr key={row.product_id} className="border-t border-slate-100">
                        <td className="px-3 py-2">{row.sku}</td>
                        <td className="px-3 py-2">{formatBRL(row.revenue)}</td>
                        <td className="px-3 py-2">{formatBRL(row.discounts)}</td>
                        <td className="px-3 py-2">{formatOptionalBRL(row.cogs)}</td>
                        <td className="px-3 py-2">{formatOptionalBRL(row.gross_profit)}</td>
                        <td className="px-3 py-2">{formatOptionalPercent(row.sell_through)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
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

function Metric({
  dataTestId,
  label,
  value,
}: {
  dataTestId?: string;
  label: string;
  value: string;
}) {
  return (
    <div data-testid={dataTestId} className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}

function SummaryCard({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section data-testid={testId} className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <div className="mt-2 space-y-1">{children}</div>
    </section>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-600">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

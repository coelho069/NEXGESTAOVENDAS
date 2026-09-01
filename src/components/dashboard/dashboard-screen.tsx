"use client";

import { useState } from "react";
import { formatBRL } from "@/lib/money";
import { PermissionGate } from "@/components/auth/permission-gate";
import type { MemberRole } from "@/lib/domain/rbac";
import type { DashboardLoadResult } from "@/lib/server/dashboard-query";

const DEMO_STORES = [
  { id: "22222222-2222-4222-8222-222222222201", name: "Loja Centro" },
  { id: "22222222-2222-4222-8222-222222222202", name: "Loja Shopping" },
];

type DashboardScreenProps = {
  storeId: string;
  initial: DashboardLoadResult;
};

export function DashboardScreen({ storeId, initial }: DashboardScreenProps) {
  const [role, setRole] = useState<MemberRole>(initial.role);
  const summary = initial.payload.summary;
  const nextHref = initial.payload.next_cursor
    ? `/dashboard?store=${storeId}&from=${initial.payload.from}&to=${initial.payload.to}&cursor=${encodeURIComponent(initial.payload.next_cursor)}`
    : null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-slate-500">
            {initial.payload.from} → {initial.payload.to} · timezone America/Sao_Paulo
          </p>
        </div>
        <label className="text-sm">
          Papel
          <select
            data-testid="dashboard-role"
            className="ml-2 rounded border border-slate-300 px-2 py-1"
            value={role}
            onChange={(event) => setRole(event.target.value as MemberRole)}
          >
            <option value="cashier">Caixa</option>
            <option value="manager">Gerente</option>
            <option value="admin">Admin</option>
          </select>
        </label>
      </div>

      <form method="get" action="/dashboard" className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <label className="text-sm">
          Loja
          <select
            name="store"
            data-testid="dashboard-store"
            defaultValue={storeId}
            className="mt-1 block rounded border border-slate-300 px-2 py-1"
          >
            {DEMO_STORES.map((store) => (
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

      <PermissionGate role={role} allow={["admin", "manager"]}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="dashboard-metrics">
          <Metric label="Receita" value={formatBRL(summary.revenue)} />
          <Metric label="COGS" value={formatBRL(summary.cogs)} />
          <Metric label="Margem" value={`${summary.marginPercent}%`} />
          <Metric label="Sell-through" value={`${summary.sellThrough}%`} />
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Receita</th>
                <th className="px-3 py-2">COGS</th>
                <th className="px-3 py-2">Lucro</th>
                <th className="px-3 py-2">Sell-through</th>
              </tr>
            </thead>
            <tbody>
              {initial.payload.rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-slate-500" colSpan={5}>
                    Sem vendas no período.
                  </td>
                </tr>
              ) : (
                initial.payload.rows.map((row) => (
                  <tr key={row.product_id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{row.sku}</td>
                    <td className="px-3 py-2">{formatBRL(row.revenue)}</td>
                    <td className="px-3 py-2">{formatBRL(row.cogs)}</td>
                    <td className="px-3 py-2">{formatBRL(row.gross_profit)}</td>
                    <td className="px-3 py-2">{row.sell_through}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {nextHref ? (
          <a data-testid="dashboard-next" href={nextHref} className="text-sm font-medium text-emerald-700">
            Próxima página
          </a>
        ) : null}
      </PermissionGate>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}

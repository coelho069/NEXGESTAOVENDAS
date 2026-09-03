"use client";

import { useMemo, useState } from "react";
import { formatBRL } from "@/lib/money";
import { PermissionGate } from "@/components/auth/permission-gate";
import { parseInventoryCsv, type CsvIssue } from "@/lib/domain/inventory";
import { canManageInventory, type MemberRole } from "@/lib/domain/rbac";
import type { InventoryLoadResult } from "@/lib/server/inventory-query";

const DEMO_STORES = [
  { id: "22222222-2222-4222-8222-222222222201", name: "Loja Centro" },
  { id: "22222222-2222-4222-8222-222222222202", name: "Loja Shopping" },
];

type InventoryScreenProps = {
  storeId: string;
  initial: InventoryLoadResult;
};

export function InventoryScreen({ storeId, initial }: InventoryScreenProps) {
  const [role, setRole] = useState<MemberRole>(initial.role);
  const [csvText, setCsvText] = useState("sku,delta,reason,movement_type\nBEV-001,10,compra,restock\n");
  const [issues, setIssues] = useState<CsvIssue[]>([]);
  const [message, setMessage] = useState<string | null>(initial.message);
  const [sku, setSku] = useState("BEV-001");
  const [delta, setDelta] = useState("1");
  const [reason, setReason] = useState("ajuste manual");
  const [newSku, setNewSku] = useState("");
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("0.00");
  const [newCost, setNewCost] = useState("0.00");
  const canAdjust = canManageInventory(role) && (initial.canAdjust || initial.degraded);
  const preview = useMemo(() => parseInventoryCsv(csvText), [csvText]);
  const nextHref = initial.nextCursor
    ? `/inventory?store=${storeId}&cursor=${encodeURIComponent(initial.nextCursor)}`
    : null;

  const submitAdjust = async () => {
    setMessage(null);
    if (initial.degraded) {
      setMessage("Ajuste não enviado: modo degradado.");
      return;
    }
    const numericDelta = Number(delta.replace(",", "."));
    const response = await fetch("/api/inventory/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        store_id: storeId,
        sku,
        delta: numericDelta,
        reason,
        movement_type: numericDelta >= 0 ? "restock" : "adjustment",
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error ?? "Falha no ajuste");
      return;
    }
    setMessage("Ajuste registrado e auditado.");
  };

  const submitImport = async () => {
    setIssues(preview.errors);
    if (preview.errors.length > 0 && preview.rows.length === 0) {
      setMessage("CSV com erros. Nada aplicado.");
      return;
    }
    if (initial.degraded) {
      setIssues(preview.errors);
      setMessage(`Prévia CSV: ${preview.rows.length} válidas, ${preview.errors.length} erros. Sem envio (degradado).`);
      return;
    }
    const response = await fetch("/api/inventory/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store_id: storeId, csv: csvText }),
    });
    const body = await response.json();
    setIssues(body.errors ?? preview.errors);
    setMessage(`Importação: ${body.appliedCount ?? 0} aplicadas, ${body.errorCount ?? 0} erros.`);
  };

  const submitProduct = async () => {
    setMessage(null);
    if (initial.degraded) {
      setMessage("Produto não enviado: modo degradado.");
      return;
    }
    const response = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku: newSku,
        name: newName,
        unit_price: newPrice,
        cost_price: newCost,
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error ?? "Falha ao criar produto");
      return;
    }
    setMessage(`Produto ${body.sku ?? newSku} criado.`);
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Inventário</h1>
          <p className="text-sm text-slate-500">Quantidade só muda via movimento auditado.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm">
            Loja
            <select
              data-testid="inventory-store"
              className="ml-2 rounded border border-slate-300 px-2 py-1"
              value={storeId}
              onChange={(event) => {
                window.location.href = `/inventory?store=${event.target.value}`;
              }}
            >
              {DEMO_STORES.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Papel
            <select
              data-testid="inventory-role"
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
      </div>

      {message ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">{message}</div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm" data-testid="inventory-table">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Produto</th>
              <th className="px-3 py-2">Qtd</th>
              <th className="px-3 py-2">Preço</th>
              <th className="px-3 py-2">Custo</th>
            </tr>
          </thead>
          <tbody>
            {initial.rows.map((row) => (
              <tr key={row.product_id} className="border-t border-slate-100">
                <td className="px-3 py-2">{row.sku}</td>
                <td className="px-3 py-2">{row.name}</td>
                <td className="px-3 py-2">{row.quantity}</td>
                <td className="px-3 py-2">{formatBRL(row.unit_price)}</td>
                <td className="px-3 py-2">{row.cost_price ? formatBRL(row.cost_price) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {nextHref ? (
        <a data-testid="inventory-next" href={nextHref} className="text-sm font-medium text-emerald-700">
          Próxima página
        </a>
      ) : null}

      <PermissionGate
        role={role}
        allow={["admin", "manager"]}
        fallback={
          <p data-testid="inventory-readonly" className="text-sm text-slate-500">
            Caixa: visualização apenas. Ajustes bloqueados.
          </p>
        }
      >
        <section data-testid="inventory-adjust" className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2">
          <div className="space-y-2">
            <h2 className="font-semibold">Ajuste (RPC)</h2>
            <input className="w-full rounded border px-3 py-2" value={sku} onChange={(event) => setSku(event.target.value)} />
            <input className="w-full rounded border px-3 py-2" value={delta} onChange={(event) => setDelta(event.target.value)} />
            <input
              className="w-full rounded border px-3 py-2"
              data-testid="inventory-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <button
              type="button"
              data-testid="inventory-adjust-submit"
              disabled={!canAdjust}
              onClick={() => void submitAdjust()}
              className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white disabled:bg-slate-300"
            >
              Registrar movimento
            </button>
          </div>
          <div className="space-y-2">
            <h2 className="font-semibold">Importar CSV</h2>
            <textarea
              data-testid="inventory-csv"
              className="h-32 w-full rounded border px-3 py-2 font-mono text-xs"
              value={csvText}
              onChange={(event) => setCsvText(event.target.value)}
            />
            <button
              type="button"
              data-testid="inventory-csv-submit"
              onClick={() => void submitImport()}
              className="rounded-lg border border-slate-300 px-4 py-2 font-semibold"
            >
              Validar / importar
            </button>
            {issues.length > 0 ? (
              <ul data-testid="inventory-csv-errors" className="text-sm text-red-700">
                {issues.map((issue) => (
                  <li key={`${issue.row}-${issue.message}`}>
                    Linha {issue.row}: {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="space-y-2 md:col-span-2">
            <h2 className="font-semibold">Novo produto</h2>
            <div className="grid gap-2 md:grid-cols-4">
              <input
                data-testid="product-sku"
                className="rounded border px-3 py-2"
                placeholder="SKU"
                value={newSku}
                onChange={(event) => setNewSku(event.target.value)}
              />
              <input
                data-testid="product-name"
                className="rounded border px-3 py-2"
                placeholder="Nome"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
              <input
                data-testid="product-price"
                className="rounded border px-3 py-2"
                placeholder="Preço 0.00"
                value={newPrice}
                onChange={(event) => setNewPrice(event.target.value)}
              />
              <input
                data-testid="product-cost"
                className="rounded border px-3 py-2"
                placeholder="Custo 0.00"
                value={newCost}
                onChange={(event) => setNewCost(event.target.value)}
              />
            </div>
            <button
              type="button"
              data-testid="product-create"
              onClick={() => void submitProduct()}
              className="rounded-lg border border-slate-300 px-4 py-2 font-semibold"
            >
              Criar produto
            </button>
          </div>
        </section>
      </PermissionGate>
    </div>
  );
}

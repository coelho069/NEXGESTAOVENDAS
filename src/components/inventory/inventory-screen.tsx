"use client";

import { useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { formatBRL } from "@/lib/money";
import { PermissionGate } from "@/components/auth/permission-gate";
import { StoreSelect } from "@/components/auth/store-select";
import { parseInventoryCsv, type CsvIssue } from "@/lib/domain/inventory";
import { canManageInventory, type MemberRole } from "@/lib/domain/rbac";
import type { InventoryLoadResult } from "@/lib/server/inventory-query";
import { toInventoryDelta, toInventoryQuantity } from "@/lib/domain/quantity";
import { getPdvLocalDbForUser } from "@/lib/offline/pdv-local-db";
import { getTerminalId } from "@/lib/offline/terminal-identity";
import { queueInventoryAdjustment } from "@/lib/offline/inventory-adjustment";
import { runSyncCycle, refreshLocalSyncState } from "@/lib/offline/sync-engine";
import { useSessionStore } from "@/stores/session-store";
import { inventoryImportMutationIdBrowser } from "@/lib/domain/inventory-idempotency";

type InventoryScreenProps = {
  storeId: string | null;
  initial: InventoryLoadResult;
};

export function InventoryScreen({ storeId, initial }: InventoryScreenProps) {
  const role = initial.role;
  const [csvText, setCsvText] = useState("sku,delta,reason,movement_type\nBEV-001,10,compra,restock\n");
  const [issues, setIssues] = useState<CsvIssue[]>([]);
  const [message, setMessage] = useState<string | null>(initial.message);
  const [adjustMutationId, setAdjustMutationId] = useState(() => uuidv4());
  const [importId, setImportId] = useState(() => loadImportId(storeId));
  const [sku, setSku] = useState("BEV-001");
  const [delta, setDelta] = useState("1");
  const [reason, setReason] = useState("ajuste manual");
  const [newSku, setNewSku] = useState("");
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("0.00");
  const [newCost, setNewCost] = useState("0.00");
  const [newBarcode, setNewBarcode] = useState("");
  const userId = useSessionStore((state) => state.userId);
  const [pendingCount, setPendingCount] = useState(0);
  const canAdjust = Boolean(storeId && canManageInventory(role) && (initial.canAdjust || initial.degraded));
  const preview = useMemo(() => parseInventoryCsv(csvText), [csvText]);
  const nextHref = storeId && initial.nextCursor
    ? `/inventory?store=${storeId}&cursor=${encodeURIComponent(initial.nextCursor)}`
    : null;

  useEffect(() => {
    if (typeof window !== "undefined" && storeId) {
      window.localStorage.setItem(importStorageKey(storeId), importId);
    }
  }, [importId, storeId]);

  useEffect(() => {
    if (!storeId || !userId) return;
    let cancelled = false;
    const db = getPdvLocalDbForUser(userId);
    void db.transaction("rw", db.inventoryBalances, async () => {
      for (const row of initial.rows) {
        const existing = await db.inventoryBalances.get([storeId, row.product_id]);
        if (existing) continue;
        const quantity = toInventoryQuantity(row.quantity);
        await db.inventoryBalances.put({
          storeId,
          productId: row.product_id,
          quantity,
          serverQuantity: quantity,
          updatedAt: new Date().toISOString(),
        });
      }
    }).catch(() => undefined);

    const flush = async () => {
      if (!navigator.onLine || cancelled) return;
      await runSyncCycle({ db, storeId, fetchFn: fetch });
      if (!cancelled) {
        const state = await refreshLocalSyncState(db);
        setPendingCount(state.pendingCount);
      }
    };
    const handleOnline = () => void flush();
    window.addEventListener("online", handleOnline);
    void flush();
    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
    };
  }, [initial.rows, storeId, userId]);

  const submitAdjust = async () => {
    setMessage(null);
    if (!storeId) {
      setMessage("Selecione uma loja autorizada.");
      return;
    }
    if (initial.degraded) {
      setMessage("Ajuste não enviado: modo degradado.");
      return;
    }
    let canonicalDelta: string;
    try {
      canonicalDelta = toInventoryDelta(delta.replace(",", "."));
    } catch {
      setMessage("Delta inválido: use até três casas decimais.");
      return;
    }
    const movementType = canonicalDelta.startsWith("-") ? "adjustment" : "restock";
    const terminalId = getTerminalId();

    const db = userId ? getPdvLocalDbForUser(userId) : null;
    if (!navigator.onLine && db) {
      try {
        await queueOfflineAdjustment(db, {
          storeId,
          productId: initial.rows.find((row) => row.sku === sku)?.product_id,
          clientMutationId: adjustMutationId,
          terminalId,
          delta: canonicalDelta,
          reason,
          movementType,
        });
        setMessage("Ajuste salvo localmente; será sincronizado quando houver rede.");
        setAdjustMutationId(uuidv4());
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Falha ao salvar ajuste offline.");
      }
      return;
    }

    let response: Response;
    try {
      response = await fetch("/api/inventory/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: storeId,
          sku,
          client_mutation_id: adjustMutationId,
          terminal_id: terminalId,
          delta: canonicalDelta,
          reason,
          movement_type: movementType,
        }),
      });
    } catch {
      if (db) {
        try {
          await queueOfflineAdjustment(db, {
            storeId,
            productId: initial.rows.find((row) => row.sku === sku)?.product_id,
            clientMutationId: adjustMutationId,
            terminalId,
            delta: canonicalDelta,
            reason,
            movementType,
          });
          setMessage("Ajuste salvo localmente; será sincronizado quando houver rede.");
          setAdjustMutationId(uuidv4());
        } catch (queueError) {
          setMessage(
            queueError instanceof Error
              ? queueError.message
              : "Falha ao salvar ajuste offline."
          );
        }
        return;
      }
      setMessage("Falha de rede no ajuste.");
      return;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.error ?? "Falha no ajuste");
      return;
    }
    setMessage(body.replay ? "Ajuste já havia sido registrado." : "Ajuste registrado e auditado.");
    setAdjustMutationId(uuidv4());
  };

  const submitImport = async () => {
    if (!storeId) {
      setMessage("Selecione uma loja autorizada.");
      return;
    }
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
    const db = userId ? getPdvLocalDbForUser(userId) : null;
    if (!navigator.onLine && db) {
      const result = await queueOfflineImport(
        db,
        storeId,
        preview.rows,
        importId,
        initial.rows
      );
      setIssues([...preview.errors, ...result.errors]);
      setMessage(
        `Importação offline: ${result.queued} operações salvas, ${result.errors.length} erros.`
      );
      if (result.errors.length === 0) setImportId(uuidv4());
      return;
    }
    try {
      const response = await fetch("/api/inventory/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store_id: storeId, import_id: importId, csv: csvText }),
      });
      const body = await response.json().catch(() => ({}));
      setIssues(body.errors ?? preview.errors);
      setMessage(`Importação: ${body.appliedCount ?? 0} aplicadas, ${body.errorCount ?? 0} erros.`);
      if (body.errorCount === 0) {
        setImportId(uuidv4());
      }
    } catch {
      if (db) {
        const result = await queueOfflineImport(
          db,
          storeId,
          preview.rows,
          importId,
          initial.rows
        );
        setIssues([...preview.errors, ...result.errors]);
        setMessage(
          `Importação offline: ${result.queued} operações salvas, ${result.errors.length} erros.`
        );
        if (result.errors.length === 0) setImportId(uuidv4());
        return;
      }
      setMessage("Falha de rede na importação.");
    }
  };

  const submitProduct = async () => {
    setMessage(null);
    if (!storeId) {
      setMessage("Selecione uma loja autorizada.");
      return;
    }
    if (initial.degraded) {
      setMessage("Produto não enviado: modo degradado.");
      return;
    }
    const response = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        store_id: storeId,
        sku: newSku,
        name: newName,
        unit_price: newPrice,
        cost_price: newCost,
        barcode: newBarcode || null,
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(
        response.status === 409 && body.error === "barcode_conflict"
          ? "Barcode já cadastrado nesta organização."
          : body.error ?? "Falha ao criar produto"
      );
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
            <StoreSelect
              testId="inventory-store"
              className="ml-2 rounded border border-slate-300 px-2 py-1"
              stores={initial.stores}
              value={storeId}
              onChange={(nextStoreId) => {
                if (nextStoreId) {
                  window.location.href = `/inventory?store=${nextStoreId}`;
                }
              }}
            />
          </label>
          <span data-testid="inventory-role" className="text-sm text-slate-500">
            Papel: {roleLabel(role)}
          </span>
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
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
              <span data-testid="inventory-import-id">Importação: {importId}</span>
              <button
                type="button"
                data-testid="inventory-import-new"
                onClick={() => {
                  setImportId(uuidv4());
                  setIssues([]);
                  setMessage(null);
                }}
                className="font-medium text-emerald-700"
              >
                Nova importação
              </button>
            </div>
            <textarea
              data-testid="inventory-csv"
              className="h-32 w-full rounded border px-3 py-2 font-mono text-xs"
              value={csvText}
              onChange={(event) => setCsvText(event.target.value)}
            />
            <button
              type="button"
              data-testid="inventory-csv-submit"
              disabled={!storeId}
              onClick={() => void submitImport()}
              className="rounded-lg border border-slate-300 px-4 py-2 font-semibold"
            >
              Validar / importar
            </button>
            {pendingCount > 0 ? (
              <p data-testid="inventory-pending" className="text-xs text-amber-700">
                {pendingCount} operação(ões) aguardando sincronização.
              </p>
            ) : null}
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
            <div className="grid gap-2 md:grid-cols-5">
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
              <input
                data-testid="product-barcode"
                className="rounded border px-3 py-2"
                placeholder="Barcode (opcional)"
                value={newBarcode}
                onChange={(event) => setNewBarcode(event.target.value)}
              />
            </div>
            <button
              type="button"
              data-testid="product-create"
              disabled={!storeId || initial.degraded}
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

async function queueOfflineAdjustment(
  db: ReturnType<typeof getPdvLocalDbForUser>,
  input: {
    storeId: string;
    clientMutationId: string;
    terminalId: string;
    delta: string;
    reason: string;
    movementType: "restock" | "adjustment";
    productId?: string;
  }
): Promise<void> {
  const productId = input.productId;
  if (!productId) {
    throw new Error("Produto não disponível para ajuste offline");
  }
  const result = await queueInventoryAdjustment(db, {
    storeId: input.storeId,
    productId,
    clientMutationId: input.clientMutationId,
    terminalId: input.terminalId,
    delta: input.delta,
    reason: input.reason,
    movementType: input.movementType,
  });
  void result;
}

async function queueOfflineImport(
  db: ReturnType<typeof getPdvLocalDbForUser>,
  storeId: string,
  rows: Array<{
    row: number;
    sku: string;
    delta: string;
    reason: string;
    movementType: "restock" | "adjustment";
  }>,
  importId: string,
  initialRows: InventoryLoadResult["rows"]
): Promise<{ queued: number; errors: CsvIssue[] }> {
  const terminalId = getTerminalId();
  const productBySku = new Map(initialRows.map((row) => [row.sku, row.product_id]));
  let queued = 0;
  const errors: CsvIssue[] = [];
  for (const row of rows) {
    const productId = productBySku.get(row.sku);
    if (!productId) {
      errors.push({
        row: row.row,
        sku: row.sku,
        message: "SKU não carregado para uso offline",
      });
      continue;
    }
    await queueInventoryAdjustment(db, {
      storeId,
      productId,
      clientMutationId: await inventoryImportMutationIdBrowser(
        storeId,
        importId,
        row.row
      ),
      terminalId,
      importId,
      importRow: row.row,
      delta: row.delta,
      reason: row.reason,
      movementType: row.movementType,
    });
    queued += 1;
  }
  return { queued, errors };
}

function importStorageKey(storeId: string): string {
  return `nex-inventory-import:${storeId}`;
}

function loadImportId(storeId: string | null): string {
  if (typeof window !== "undefined" && storeId) {
    return window.localStorage.getItem(importStorageKey(storeId)) ?? uuidv4();
  }
  return uuidv4();
}

function roleLabel(role: MemberRole | null): string {
  if (role === "admin") return "Admin";
  if (role === "manager") return "Gerente";
  if (role === "cashier") return "Caixa";
  return "Não disponível";
}

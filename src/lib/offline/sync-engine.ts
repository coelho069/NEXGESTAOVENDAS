import { v4 as uuidv4 } from "uuid";
import type { ProcessSaleResult } from "@/lib/db/types";
import { classifySyncHttpStatus } from "@/lib/offline/http-classify";
import {
  listDueOutboxCommands,
  markOutboxConflict,
  markOutboxFailed,
  markOutboxProcessing,
  markOutboxSynced,
  releaseOutboxProcessing,
  resetStuckProcessing,
  scheduleOutboxRetry,
} from "@/lib/offline/outbox";
import type { PdvLocalDatabase } from "@/lib/offline/pdv-local-db";
import type { LocalConflict, LocalSale, OutboxCommand, PullChangesResponse } from "@/lib/offline/types";

export type SyncEngineDeps = {
  db: PdvLocalDatabase;
  fetchFn: typeof fetch;
  storeId?: string | null;
  now?: () => Date;
  random?: () => number;
  onEndSession?: () => void | Promise<void>;
  processSaleUrl?: string;
  pullChangesUrl?: string;
};

export async function reconcileSale(
  db: PdvLocalDatabase,
  clientMutationId: string,
  server: Pick<ProcessSaleResult, "sale_id"> & { status?: string; total?: string }
): Promise<LocalSale> {
  const sale = await db.sales.where("clientMutationId").equals(clientMutationId).first();
  if (!sale) {
    throw new Error(`Sale not found for clientMutationId ${clientMutationId}`);
  }

  const now = new Date().toISOString();
  const confirmed: LocalSale = {
    ...sale,
    status: "confirmed",
    syncStatus: "synced",
    serverSaleId: server.sale_id,
    confirmedAt: now,
    total: server.total ?? sale.total,
  };

  await db.transaction("rw", [db.sales, db.outbox, db.payments], async () => {
    await db.sales.put(confirmed);
    await markOutboxSynced(db, clientMutationId, new Date(now));
    const payments = await db.payments.where("saleId").equals(sale.id).toArray();
    for (const payment of payments) {
      await db.payments.put({ ...payment, status: "captured" });
    }
  });

  return confirmed;
}

export async function recordConflict(
  db: PdvLocalDatabase,
  input: { clientMutationId: string; httpStatus: number; message: string }
): Promise<LocalConflict> {
  const existing = await db.conflicts.where("clientMutationId").equals(input.clientMutationId).first();
  if (existing) return existing;

  const sale = await db.sales.where("clientMutationId").equals(input.clientMutationId).first();
  const now = new Date();
  const conflict: LocalConflict = {
    id: uuidv4(),
    clientMutationId: input.clientMutationId,
    saleId: sale?.id ?? input.clientMutationId,
    httpStatus: input.httpStatus,
    message: input.message,
    createdAt: now.toISOString(),
    visible: true,
  };

  await db.transaction("rw", [db.sales, db.saleItems, db.outbox, db.conflicts, db.inventoryBalances], async () => {
    if (sale && sale.syncStatus !== "conflict" && sale.syncStatus !== "failed") {
      await restoreProjectedInventory(db, sale.id);
      await db.sales.put({ ...sale, syncStatus: "conflict" });
    }
    const outbox = await db.outbox.get(input.clientMutationId);
    if (outbox) {
      await markOutboxConflict(db, input.clientMutationId, input.message, now);
    }
    await db.conflicts.add(conflict);
  });

  return conflict;
}

export async function listVisibleConflicts(db: PdvLocalDatabase): Promise<LocalConflict[]> {
  const rows = await db.conflicts.toArray();
  return rows.filter((row) => row.visible);
}

export async function countUnsyncedCommands(db: PdvLocalDatabase): Promise<number> {
  return db.outbox.where("status").anyOf(["pending", "processing"]).count();
}

export async function pushPendingCommands(deps: SyncEngineDeps): Promise<void> {
  const now = deps.now?.() ?? new Date();
  await resetStuckProcessing(deps.db, now);
  const due = await listDueOutboxCommands(deps.db, now);

  for (const command of due) {
    await pushOutboxCommand(deps, command);
  }
}

export async function pushOutboxCommand(deps: SyncEngineDeps, command: OutboxCommand): Promise<void> {
  if (command.payload.client_mutation_id !== command.clientMutationId) {
    throw new Error("clientMutationId is immutable; retry must not recreate the outbox key");
  }
  if (command.status === "synced" || command.status === "conflict" || command.status === "failed") {
    return;
  }

  const now = deps.now?.() ?? new Date();
  await markOutboxProcessing(deps.db, command.clientMutationId, now);

  let response: Response;
  try {
    response = await deps.fetchFn(deps.processSaleUrl ?? "/api/sales/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(command.payload),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "network error";
    await scheduleOutboxRetry(deps.db, command.clientMutationId, message, {
      now: deps.now?.() ?? new Date(),
      random: deps.random,
    });
    return;
  }

  await applyPushResponse(deps, command.clientMutationId, response);
}

export async function pullChanges(deps: SyncEngineDeps): Promise<PullChangesResponse | null> {
  if (!deps.storeId) return null;

  const since = await deps.db.meta.get("lastPullAt");
  const params = new URLSearchParams({ store_id: deps.storeId });
  if (since?.value) params.set("since", since.value);
  const url = `${deps.pullChangesUrl ?? "/api/sync/changes"}?${params.toString()}`;

  let response: Response;
  try {
    response = await deps.fetchFn(url, { method: "GET", credentials: "include" });
  } catch {
    return null;
  }

  const klass = classifySyncHttpStatus(response.status);
  if (klass === "end_session") {
    await deps.onEndSession?.();
    return null;
  }
  if (klass !== "success") return null;

  const payload = (await response.json()) as PullChangesResponse;
  await applyPulledChanges(deps.db, deps.storeId, payload);
  return payload;
}

export async function runSyncCycle(deps: SyncEngineDeps): Promise<void> {
  await pushPendingCommands(deps);
  await pullChanges(deps);
}

export async function refreshLocalSyncState(db: PdvLocalDatabase): Promise<{
  pendingCount: number;
  conflicts: LocalConflict[];
}> {
  const pendingCount = await countUnsyncedCommands(db);
  const conflicts = await listVisibleConflicts(db);
  return { pendingCount, conflicts };
}

async function applyPushResponse(
  deps: SyncEngineDeps,
  clientMutationId: string,
  response: Response
): Promise<void> {
  const klass = classifySyncHttpStatus(response.status);
  const body = await readJson(response);
  const message = body.error ?? `HTTP ${response.status}`;

  if (klass === "success") {
    if (!body.sale_id) {
      await scheduleOutboxRetry(deps.db, clientMutationId, "missing sale_id", {
        now: deps.now?.() ?? new Date(),
        random: deps.random,
      });
      return;
    }
    await reconcileSale(deps.db, clientMutationId, {
      sale_id: body.sale_id,
      status: body.status,
      total: body.total,
    });
    return;
  }

  if (klass === "end_session") {
    await releaseOutboxProcessing(deps.db, clientMutationId, deps.now?.() ?? new Date());
    await deps.onEndSession?.();
    return;
  }

  if (klass === "transient") {
    await scheduleOutboxRetry(deps.db, clientMutationId, message, {
      now: deps.now?.() ?? new Date(),
      random: deps.random,
    });
    return;
  }

  if (klass === "conflict") {
    await recordConflict(deps.db, {
      clientMutationId,
      httpStatus: response.status,
      message,
    });
    return;
  }

  await markOutboxFailed(deps.db, clientMutationId, message, deps.now?.() ?? new Date());
}

async function applyPulledChanges(
  db: PdvLocalDatabase,
  storeId: string,
  payload: PullChangesResponse
): Promise<void> {
  const reserved = await pendingReservations(db, storeId);

  await db.transaction("rw", [db.inventoryBalances, db.sales, db.outbox, db.payments, db.meta], async () => {
    for (const row of payload.inventory) {
      if (row.store_id !== storeId) continue;
      const reservedQty = reserved.get(row.product_id) ?? 0;
      const serverQuantity = Number(row.quantity);
      await db.inventoryBalances.put({
        storeId: row.store_id,
        productId: row.product_id,
        serverQuantity,
        quantity: Math.max(0, serverQuantity - reservedQty),
        updatedAt: row.updated_at,
      });
    }

    await db.meta.put({ key: "lastPullAt", value: payload.serverTime });
  });

  for (const remoteSale of payload.sales) {
    if (remoteSale.status !== "confirmed") continue;
    const local = await db.sales.where("clientMutationId").equals(remoteSale.client_mutation_id).first();
    if (local && local.syncStatus !== "synced") {
      await reconcileSale(db, remoteSale.client_mutation_id, {
        sale_id: remoteSale.id,
        status: remoteSale.status,
        total: String(remoteSale.total),
      });
    }
  }
}

async function pendingReservations(db: PdvLocalDatabase, storeId: string): Promise<Map<string, number>> {
  const sales = await db.sales.where("storeId").equals(storeId).toArray();
  const active = sales.filter((sale) => sale.syncStatus === "pending" || sale.syncStatus === "processing");
  const reserved = new Map<string, number>();
  for (const sale of active) {
    const items = await db.saleItems.where("saleId").equals(sale.id).toArray();
    for (const item of items) {
      reserved.set(item.productId, (reserved.get(item.productId) ?? 0) + item.quantity);
    }
  }
  return reserved;
}

async function restoreProjectedInventory(db: PdvLocalDatabase, saleId: string): Promise<void> {
  const sale = await db.sales.get(saleId);
  if (!sale) return;
  const items = await db.saleItems.where("saleId").equals(saleId).toArray();
  const now = new Date().toISOString();
  for (const item of items) {
    const balance = await db.inventoryBalances.get([sale.storeId, item.productId]);
    await db.inventoryBalances.put({
      storeId: sale.storeId,
      productId: item.productId,
      quantity: (balance?.quantity ?? 0) + item.quantity,
      serverQuantity: balance?.serverQuantity ?? 0,
      updatedAt: now,
    });
  }
}

async function readJson(response: Response): Promise<{
  error?: string;
  sale_id?: string;
  replay?: boolean;
  status?: string;
  total?: string;
}> {
  try {
    return (await response.json()) as {
      error?: string;
      sale_id?: string;
      replay?: boolean;
      status?: string;
      total?: string;
    };
  } catch {
    return {};
  }
}

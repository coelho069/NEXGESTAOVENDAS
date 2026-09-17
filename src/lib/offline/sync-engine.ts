import { validate as validateUuid, v4 as uuidv4 } from "uuid";
import type { ProcessSaleResult } from "@/lib/db/types";
import { money, toMoneyString } from "@/lib/money";
import { shouldMarkOutboxFailed } from "@/lib/offline/backoff";
import { classifySyncHttpStatus } from "@/lib/offline/http-classify";
import {
  listDueOutboxCommands,
  claimOutboxProcessing,
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
  requestTimeoutMs?: number;
};

export async function reconcileSale(
  db: PdvLocalDatabase,
  clientMutationId: string,
  server: Pick<ProcessSaleResult, "sale_id"> & {
    status?: string;
    total?: string | number;
    stockReconciled?: boolean;
  },
  expectedProcessingUpdatedAt?: string
): Promise<LocalSale> {
  const sale = await db.sales.where("clientMutationId").equals(clientMutationId).first();
  if (!sale) {
    throw new Error(`Sale not found for clientMutationId ${clientMutationId}`);
  }

  const now = new Date().toISOString();
  let reconciled = sale;

  await db.transaction("rw", [db.sales, db.outbox, db.payments, db.conflicts], async () => {
    const currentSale = await db.sales.where("clientMutationId").equals(clientMutationId).first();
    const currentOutbox = await db.outbox.get(clientMutationId);
    if (!currentSale || !currentOutbox) {
      throw new Error(`Sale outbox not found for clientMutationId ${clientMutationId}`);
    }
    if (
      expectedProcessingUpdatedAt &&
      (currentOutbox.status !== "processing" || currentOutbox.updatedAt !== expectedProcessingUpdatedAt)
    ) {
      reconciled = currentSale;
      return;
    }
    if (currentOutbox.status === "failed" || (currentOutbox.status === "conflict" && !currentOutbox.outcomeUnknown)) {
      reconciled = currentSale;
      return;
    }

    reconciled = {
      ...currentSale,
      status: "confirmed",
      syncStatus: "synced",
      serverSaleId: server.sale_id,
      confirmedAt: now,
      total: normalizeMoneyValue(server.total) ?? currentSale.total,
      stockReconciled: server.stockReconciled ?? currentSale.stockReconciled ?? false,
      outcomeUnknown: undefined,
    };
    await db.sales.put(reconciled);
    if (currentOutbox.status !== "synced") {
      await db.outbox.put({
        ...currentOutbox,
        status: "synced",
        lastError: undefined,
        outcomeUnknown: undefined,
        updatedAt: now,
      });
    }
    const payments = await db.payments.where("saleId").equals(currentSale.id).toArray();
    for (const payment of payments) {
      await db.payments.put({ ...payment, status: "captured" });
    }
    const conflicts = await db.conflicts.where("clientMutationId").equals(clientMutationId).toArray();
    for (const conflict of conflicts) {
      if (conflict.visible) {
        await db.conflicts.put({ ...conflict, visible: false });
      }
    }
  });

  return reconciled;
}

export async function recordConflict(
  db: PdvLocalDatabase,
  input: {
    clientMutationId: string;
    httpStatus: number;
    message: string;
    expectedProcessingUpdatedAt?: string;
  }
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
    const currentOutbox = await db.outbox.get(input.clientMutationId);
    const currentSale = await db.sales.where("clientMutationId").equals(input.clientMutationId).first();
    if (!currentOutbox) {
      throw new Error(`Outbox command not found: ${input.clientMutationId}`);
    }
    if (
      currentOutbox.status === "synced" ||
      currentOutbox.status === "conflict" ||
      currentOutbox.status === "failed" ||
      (input.expectedProcessingUpdatedAt !== undefined &&
        (currentOutbox.status !== "processing" ||
          currentOutbox.updatedAt !== input.expectedProcessingUpdatedAt))
    ) {
      return;
    }
    if (
      currentSale &&
      (currentSale.syncStatus === "pending" || currentSale.syncStatus === "processing")
    ) {
      await db.sales.put({ ...currentSale, syncStatus: "conflict" });
      await restoreProjectedInventory(db, currentSale.id);
    }
    await db.outbox.put({
      ...currentOutbox,
      status: "conflict",
      lastError: input.message,
      updatedAt: now.toISOString(),
    });
    const existingConflict = await db.conflicts
      .where("clientMutationId")
      .equals(input.clientMutationId)
      .first();
    if (!existingConflict) {
      await db.conflicts.add(conflict);
    }
  });

  return conflict;
}

export async function listVisibleConflicts(db: PdvLocalDatabase): Promise<LocalConflict[]> {
  const rows = await db.conflicts.toArray();
  return rows.filter((row) => row.visible);
}

export async function countUnsyncedCommands(db: PdvLocalDatabase): Promise<number> {
  return db.outbox.where("status").anyOf(["pending", "processing", "failed", "conflict"]).count();
}

export async function pushPendingCommands(deps: SyncEngineDeps): Promise<void> {
  const now = deps.now?.() ?? new Date();
  await resetStuckProcessing(deps.db, now, 30_000, deps.storeId);
  const due = await listDueOutboxCommands(deps.db, now, deps.storeId);

  for (const command of due) {
    await pushOutboxCommand(deps, command);
  }
}

export async function pushOutboxCommand(deps: SyncEngineDeps, command: OutboxCommand): Promise<void> {
  if (command.payload.client_mutation_id !== command.clientMutationId) {
    throw new Error("clientMutationId is immutable; retry must not recreate the outbox key");
  }
  if (command.status !== "pending") {
    return;
  }

  const now = deps.now?.() ?? new Date();
  const processing = await claimOutboxProcessing(deps.db, command.clientMutationId, command.updatedAt, now);
  if (!processing) return;

  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.requestTimeoutMs ?? 20_000);
  try {
    response = await deps.fetchFn(deps.processSaleUrl ?? "/api/sales/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(processing.payload),
      signal: controller.signal,
    });
  } catch (error) {
    const message = controller.signal.aborted
      ? "request timeout"
      : error instanceof Error
        ? error.message
        : "network error";
    await scheduleRetryOrResolve(deps, processing, message, true);
    return;
  } finally {
    clearTimeout(timeout);
  }

  await applyPushResponse(deps, processing.clientMutationId, processing.updatedAt, response);
}

export async function pullChanges(deps: SyncEngineDeps): Promise<PullChangesResponse | null> {
  if (!deps.storeId) return null;

  const cursorKey = `lastPullAt:${deps.storeId}`;
  const since = await deps.db.meta.get(cursorKey);
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

  let payload: PullChangesResponse | null;
  try {
    payload = parsePullChangesPayload(await response.json());
  } catch {
    payload = null;
  }
  if (!payload) return null;
  await applyPulledChanges(deps.db, deps.storeId, payload, cursorKey);
  return payload;
}

export async function runSyncCycle(deps: SyncEngineDeps): Promise<void> {
  await pushPendingCommands(deps);
  await pullChanges(deps);
}

export async function refreshLocalSyncState(db: PdvLocalDatabase): Promise<{
  pendingCount: number;
  failedCount: number;
  conflicts: LocalConflict[];
}> {
  const pendingCount = await countUnsyncedCommands(db);
  const failedCount = await db.outbox.where("status").equals("failed").count();
  const conflicts = await listVisibleConflicts(db);
  return { pendingCount, failedCount, conflicts };
}

async function applyPushResponse(
  deps: SyncEngineDeps,
  clientMutationId: string,
  expectedProcessingUpdatedAt: string,
  response: Response
): Promise<void> {
  const processing = await deps.db.outbox.get(clientMutationId);
  if (
    !processing ||
    processing.status !== "processing" ||
    processing.updatedAt !== expectedProcessingUpdatedAt
  ) {
    return;
  }

  const klass = classifySyncHttpStatus(response.status);
  const body = await readJson(response);
  const message = body.error ?? `HTTP ${response.status}`;

  if (klass === "success") {
    if (!body.sale_id || !validateUuid(body.sale_id)) {
      await scheduleRetryOrResolve(
        deps,
        processing,
        body.sale_id ? "invalid sale_id" : "missing sale_id",
        true
      );
      return;
    }
    await reconcileSale(deps.db, clientMutationId, {
      sale_id: body.sale_id,
      status: body.status,
      total: body.total,
    }, expectedProcessingUpdatedAt);
    return;
  }

  if (klass === "end_session") {
    await releaseOutboxProcessing(
      deps.db,
      clientMutationId,
      deps.now?.() ?? new Date(),
      expectedProcessingUpdatedAt
    );
    await deps.onEndSession?.();
    return;
  }

  if (klass === "transient") {
    await scheduleRetryOrResolve(deps, processing, message, true);
    return;
  }

  if (klass === "conflict") {
    await recordConflict(deps.db, {
      clientMutationId,
      httpStatus: response.status,
      message,
      expectedProcessingUpdatedAt,
    });
    return;
  }

  await markProcessingCommandFailed(
    deps.db,
    clientMutationId,
    message,
    deps.now?.() ?? new Date(),
    expectedProcessingUpdatedAt
  );
}

async function applyPulledChanges(
  db: PdvLocalDatabase,
  storeId: string,
  payload: PullChangesResponse,
  cursorKey: string
): Promise<void> {
  for (const remoteSale of payload.sales) {
    if (remoteSale.status !== "confirmed") continue;
    const local = await db.sales.where("clientMutationId").equals(remoteSale.client_mutation_id).first();
    if (local && (local.syncStatus !== "synced" || local.stockReconciled !== true)) {
      const stockReconciled = await canReconcileSaleStock(db, local, remoteSale, payload.inventory);
      await reconcileSale(db, remoteSale.client_mutation_id, {
        sale_id: remoteSale.id,
        status: remoteSale.status,
        total: normalizeMoneyValue(remoteSale.total),
        stockReconciled,
      });
    }
  }

  await db.transaction(
    "rw",
    [db.inventoryBalances, db.sales, db.saleItems, db.outbox, db.payments, db.meta],
    async () => {
      const reserved = await pendingReservations(db, storeId);
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

      await db.meta.put({ key: cursorKey, value: payload.serverTime });
    }
  );
}

async function pendingReservations(
  db: PdvLocalDatabase,
  storeId: string,
  excludeSaleId?: string
): Promise<Map<string, number>> {
  const sales = await db.sales.where("storeId").equals(storeId).toArray();
  const active = sales.filter(
    (sale) =>
      sale.id !== excludeSaleId &&
      (sale.syncStatus === "pending" ||
        sale.syncStatus === "processing" ||
        (sale.syncStatus === "synced" && sale.stockReconciled !== true))
  );
  const reserved = new Map<string, number>();
  for (const sale of active) {
    const items = await db.saleItems.where("saleId").equals(sale.id).toArray();
    for (const item of items) {
      reserved.set(item.productId, (reserved.get(item.productId) ?? 0) + item.quantity);
    }
  }
  return reserved;
}

async function canReconcileSaleStock(
  db: PdvLocalDatabase,
  sale: LocalSale,
  remoteSale: PullChangesResponse["sales"][number],
  inventory: PullChangesResponse["inventory"]
): Promise<boolean> {
  const items = await db.saleItems.where("saleId").equals(sale.id).toArray();
  if (items.length === 0) return false;
  const saleUpdatedAt = Date.parse(remoteSale.updated_at);
  if (Number.isNaN(saleUpdatedAt)) return false;
  return items.every((item) => {
    const row = inventory.find(
      (candidate) => candidate.store_id === sale.storeId && candidate.product_id === item.productId
    );
    return row !== undefined && Date.parse(row.updated_at) >= saleUpdatedAt;
  });
}

async function restoreProjectedInventory(db: PdvLocalDatabase, saleId: string): Promise<void> {
  const sale = await db.sales.get(saleId);
  if (!sale) return;
  const items = await db.saleItems.where("saleId").equals(saleId).toArray();
  const reserved = await pendingReservations(db, sale.storeId, saleId);
  const now = new Date().toISOString();
  const productIds = new Set(items.map((item) => item.productId));
  for (const productId of productIds) {
    const balance = await db.inventoryBalances.get([sale.storeId, productId]);
    const serverQuantity = balance?.serverQuantity ?? balance?.quantity ?? 0;
    await db.inventoryBalances.put({
      storeId: sale.storeId,
      productId,
      quantity: Math.max(0, serverQuantity - (reserved.get(productId) ?? 0)),
      serverQuantity,
      updatedAt: now,
    });
  }
}

async function scheduleRetryOrResolve(
  deps: SyncEngineDeps,
  processing: OutboxCommand,
  message: string,
  outcomeUnknown: boolean
): Promise<void> {
  const current = await deps.db.outbox.get(processing.clientMutationId);
  if (
    !current ||
    current.status !== "processing" ||
    current.updatedAt !== processing.updatedAt
  ) {
    return;
  }

  if (shouldMarkOutboxFailed(current.attemptCount + 1)) {
    if (outcomeUnknown) {
      await markProcessingCommandUncertain(
        deps.db,
        processing.clientMutationId,
        message,
        deps.now?.() ?? new Date(),
        processing.updatedAt
      );
    } else {
      await markProcessingCommandFailed(
        deps.db,
        processing.clientMutationId,
        message,
        deps.now?.() ?? new Date(),
        processing.updatedAt
      );
    }
    return;
  }

  await scheduleOutboxRetry(deps.db, processing.clientMutationId, message, {
    now: deps.now?.() ?? new Date(),
    random: deps.random,
  });
}

async function markProcessingCommandUncertain(
  db: PdvLocalDatabase,
  clientMutationId: string,
  message: string,
  now: Date,
  expectedProcessingUpdatedAt: string
): Promise<OutboxCommand | null> {
  let uncertain: OutboxCommand | null = null;
  await db.transaction(
    "rw",
    [db.outbox, db.sales, db.payments, db.conflicts],
    async () => {
      const currentOutbox = await db.outbox.get(clientMutationId);
      if (
        !currentOutbox ||
        currentOutbox.status !== "processing" ||
        currentOutbox.updatedAt !== expectedProcessingUpdatedAt
      ) {
        return;
      }

      const next: OutboxCommand = {
        ...currentOutbox,
        status: "conflict",
        attemptCount: currentOutbox.attemptCount + 1,
        lastError: `outcome uncertain: ${message}`,
        outcomeUnknown: true,
        updatedAt: now.toISOString(),
      };
      uncertain = next;
      await db.outbox.put(next);

      const sale = await db.sales.get(currentOutbox.saleId);
      if (sale) {
        await db.sales.put({
          ...sale,
          syncStatus: "conflict",
          outcomeUnknown: true,
        });
        const existingConflict = await db.conflicts
          .where("clientMutationId")
          .equals(clientMutationId)
          .first();
        if (!existingConflict) {
          await db.conflicts.add({
            id: uuidv4(),
            clientMutationId,
            saleId: sale.id,
            httpStatus: 0,
            message: `Resultado remoto incerto: ${message}`,
            createdAt: now.toISOString(),
            visible: true,
          });
        }
      }
    }
  );
  return uncertain;
}

async function markProcessingCommandFailed(
  db: PdvLocalDatabase,
  clientMutationId: string,
  message: string,
  now: Date,
  expectedProcessingUpdatedAt?: string
): Promise<OutboxCommand | null> {
  let failed: OutboxCommand | null = null;
  await db.transaction(
    "rw",
    [db.outbox, db.sales, db.saleItems, db.payments, db.inventoryBalances],
    async () => {
      const currentOutbox = await db.outbox.get(clientMutationId);
      if (
        !currentOutbox ||
        currentOutbox.status !== "processing" ||
        (expectedProcessingUpdatedAt && currentOutbox.updatedAt !== expectedProcessingUpdatedAt)
      ) {
        return;
      }

      const next: OutboxCommand = {
        ...currentOutbox,
        status: "failed",
        attemptCount: currentOutbox.attemptCount + 1,
        lastError: message,
        updatedAt: now.toISOString(),
      };
      failed = next;
      await db.outbox.put(next);

      const sale = await db.sales.get(currentOutbox.saleId);
      if (!sale || sale.syncStatus === "synced" || sale.syncStatus === "conflict") return;

      await db.sales.put({ ...sale, syncStatus: "failed", stockReconciled: true });
      const payments = await db.payments.where("saleId").equals(currentOutbox.saleId).toArray();
      for (const payment of payments) {
        await db.payments.put({ ...payment, status: "failed" });
      }
      await restoreProjectedInventory(db, currentOutbox.saleId);
    }
  );
  return failed;
}

async function readJson(response: Response): Promise<{
  error?: string;
  sale_id?: string;
  replay?: boolean;
  status?: string;
  total?: string;
}> {
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== "object") return {};
    const body = value as Record<string, unknown>;
    return {
      error: typeof body.error === "string" ? body.error : undefined,
      sale_id: typeof body.sale_id === "string" ? body.sale_id : undefined,
      replay: typeof body.replay === "boolean" ? body.replay : undefined,
      status: typeof body.status === "string" ? body.status : undefined,
      total: normalizeMoneyValue(body.total),
    };
  } catch {
    return {};
  }
}

function normalizeMoneyValue(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  try {
    const normalized = money(value);
    if (normalized.isNaN() || !normalized.isFinite() || normalized.lt(0)) return undefined;
    return toMoneyString(normalized);
  } catch {
    return undefined;
  }
}

function normalizeQuantityValue(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  try {
    const normalized = money(value);
    if (
      normalized.isNaN() ||
      !normalized.isFinite() ||
      normalized.lt(0) ||
      normalized.gt("999999999.999") ||
      normalized.decimalPlaces() > 3
    ) {
      return undefined;
    }
    return normalized.toNumber();
  } catch {
    return undefined;
  }
}

function parsePullChangesPayload(value: unknown): PullChangesResponse | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.serverTime !== "string" ||
    Number.isNaN(Date.parse(payload.serverTime)) ||
    !Array.isArray(payload.inventory) ||
    !Array.isArray(payload.sales)
  ) {
    return null;
  }

  const inventory: PullChangesResponse["inventory"] = [];
  for (const value of payload.inventory) {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    const quantity = normalizeQuantityValue(row.quantity);
    if (
      typeof row.store_id !== "string" ||
      !validateUuid(row.store_id) ||
      typeof row.product_id !== "string" ||
      !validateUuid(row.product_id) ||
      quantity === undefined ||
      typeof row.updated_at !== "string" ||
      Number.isNaN(Date.parse(row.updated_at))
    ) {
      return null;
    }
    inventory.push({
      store_id: row.store_id,
      product_id: row.product_id,
      quantity,
      updated_at: row.updated_at,
    });
  }

  const sales: PullChangesResponse["sales"] = [];
  for (const value of payload.sales) {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    const total = normalizeMoneyValue(row.total);
    if (
      typeof row.id !== "string" ||
      !validateUuid(row.id) ||
      typeof row.client_mutation_id !== "string" ||
      !validateUuid(row.client_mutation_id) ||
      typeof row.status !== "string" ||
      ![
        "draft",
        "pending_sync",
        "confirmed",
        "cancelled",
        "refunded",
        "partially_refunded",
      ].includes(row.status) ||
      typeof row.sync_status !== "string" ||
      !["pending", "processing", "synced", "failed", "conflict"].includes(row.sync_status) ||
      total === undefined ||
      typeof row.updated_at !== "string" ||
      Number.isNaN(Date.parse(row.updated_at))
    ) {
      return null;
    }
    sales.push({
      id: row.id,
      client_mutation_id: row.client_mutation_id,
      status: row.status as PullChangesResponse["sales"][number]["status"],
      sync_status: row.sync_status as PullChangesResponse["sales"][number]["sync_status"],
      total,
      updated_at: row.updated_at,
    });
  }

  return {
    serverTime: payload.serverTime,
    inventory,
    sales,
  };
}

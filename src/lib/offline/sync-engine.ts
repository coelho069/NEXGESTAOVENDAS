import { validate as validateUuid, v4 as uuidv4 } from "uuid";
import type { ProcessSaleResult } from "@/lib/db/rpc-types";
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
import {
  claimInventoryAdjustment,
  getInventoryAdjustment,
  listDueInventoryAdjustments,
  releaseInventoryAdjustment,
  resetStuckInventoryAdjustments,
  scheduleInventoryAdjustmentRetry,
} from "@/lib/offline/inventory-outbox";
import {
  markInventoryAdjustmentFailed,
  markInventoryAdjustmentUncertain,
  pendingInventoryDeltas,
  projectInventoryQuantity,
  reconcileInventoryAdjustment,
  recordInventoryConflict,
  type RemoteInventoryMovement,
} from "@/lib/offline/inventory-sync";
import {
  addInventoryDifferences,
  toInventoryDelta,
  toInventoryDifference,
  toInventoryQuantity,
} from "@/lib/domain/quantity";
import type { PdvLocalDatabase } from "@/lib/offline/pdv-local-db";
import type {
  InventoryOutboxCommand,
  LocalConflict,
  LocalSale,
  OutboxCommand,
  PullChangesResponse,
} from "@/lib/offline/types";

export type SyncEngineDeps = {
  db: PdvLocalDatabase;
  fetchFn: typeof fetch;
  storeId?: string | null;
  now?: () => Date;
  random?: () => number;
  onEndSession?: () => void | Promise<void>;
  processSaleUrl?: string;
  inventoryAdjustUrl?: string;
  pullChangesUrl?: string;
  requestTimeoutMs?: number;
};

const MAX_PULL_PAGES = 100;
const FISCAL_STATUSES = [
  "not_configured",
  "pending",
  "issued",
  "failed",
  "cancelled",
  "unknown",
] as const;
type FiscalStatus = (typeof FISCAL_STATUSES)[number];

type PullCursor = {
  since: string | null;
  salesAfterUpdatedAt?: string;
  salesAfterId?: string;
  inventoryAfterUpdatedAt?: string;
  inventoryAfterProductId?: string;
  inventoryAfterCreatedAt?: string;
  inventoryAfterId?: string;
};

export async function reconcileSale(
  db: PdvLocalDatabase,
  clientMutationId: string,
  server: Pick<ProcessSaleResult, "sale_id"> & {
    status: string;
    total?: string | number;
    stockReconciled?: boolean;
    fiscalStatus?: FiscalStatus;
  },
  expectedProcessingUpdatedAt?: string
): Promise<LocalSale> {
  if (server.status !== "confirmed") {
    throw new Error("Server sale is not confirmed");
  }

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
      fiscalStatus: server.fiscalStatus ?? currentSale.fiscalStatus ?? "pending",
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

export async function reconcilePaymentOutcome(
  db: PdvLocalDatabase,
  clientMutationId: string,
  status: "failed" | "cancelled",
  message = `Pagamento ${status}`
): Promise<void> {
  await db.transaction(
    "rw",
    [db.sales, db.saleItems, db.outbox, db.payments, db.conflicts, db.inventoryBalances],
    async () => {
      const sale = await db.sales.where("clientMutationId").equals(clientMutationId).first();
      const outbox = await db.outbox.get(clientMutationId);
      if (!sale || !outbox) {
        throw new Error(`Sale outbox not found for clientMutationId ${clientMutationId}`);
      }

      const now = new Date().toISOString();
      await db.sales.put({
        ...sale,
        status: "cancelled",
        syncStatus: "failed",
        stockReconciled: true,
        outcomeUnknown: undefined,
      });
      await db.outbox.put({
        ...outbox,
        status: "failed",
        lastError: message,
        outcomeUnknown: undefined,
        updatedAt: now,
      });

      const payments = await db.payments.where("saleId").equals(sale.id).toArray();
      for (const payment of payments) {
        await db.payments.put({ ...payment, status });
      }

      const conflicts = await db.conflicts.where("clientMutationId").equals(clientMutationId).toArray();
      for (const conflict of conflicts) {
        if (conflict.visible) {
          await db.conflicts.put({ ...conflict, visible: false });
        }
      }

      await restoreProjectedInventory(db, sale.id);
    }
  );
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
  const [sales, inventory] = await Promise.all([
    db.outbox.where("status").anyOf(["pending", "processing", "failed", "conflict"]).count(),
    db.inventoryOutbox
      .where("status")
      .anyOf(["pending", "processing", "failed", "conflict"])
      .count(),
  ]);
  return sales + inventory;
}

export async function pushPendingCommands(deps: SyncEngineDeps): Promise<void> {
  const now = deps.now?.() ?? new Date();
  await resetStuckProcessing(deps.db, now, 30_000, deps.storeId);
  await resetStuckInventoryAdjustments(deps.db, now, 30_000, deps.storeId);
  const due = await listDueOutboxCommands(deps.db, now, deps.storeId);
  const inventoryDue = await listDueInventoryAdjustments(deps.db, now, deps.storeId);

  for (const command of due) {
    await pushOutboxCommand(deps, command);
  }
  for (const command of inventoryDue) {
    await pushInventoryOutboxCommand(deps, command);
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
    clearTimeout(timeout);
    const message = controller.signal.aborted
      ? "request timeout"
      : error instanceof Error
        ? error.message
        : "network error";
    await scheduleRetryOrResolve(deps, processing, message, true);
    return;
  }

  try {
    await applyPushResponse(deps, processing.clientMutationId, processing.updatedAt, response, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

export async function pushInventoryOutboxCommand(
  deps: SyncEngineDeps,
  command: InventoryOutboxCommand
): Promise<void> {
  if (command.payload.client_mutation_id !== command.clientMutationId) {
    throw new Error("clientMutationId is immutable; retry must not recreate the outbox key");
  }
  if (command.status !== "pending") return;

  const now = deps.now?.() ?? new Date();
  const processing = await claimInventoryAdjustment(
    deps.db,
    command.clientMutationId,
    command.updatedAt,
    now
  );
  if (!processing) return;

  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.requestTimeoutMs ?? 20_000);
  try {
    response = await deps.fetchFn(deps.inventoryAdjustUrl ?? "/api/inventory/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(processing.payload),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    const message = controller.signal.aborted
      ? "request timeout"
      : error instanceof Error
        ? error.message
        : "network error";
    await scheduleInventoryRetryOrResolve(deps, processing, message, true);
    return;
  }

  try {
    await applyInventoryPushResponse(
      deps,
      processing.clientMutationId,
      processing.updatedAt,
      response,
      controller.signal
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function pullChanges(deps: SyncEngineDeps): Promise<PullChangesResponse | null> {
  if (!deps.storeId) return null;

  const cursorKey = `lastPullAt:${deps.storeId}`;
  const storedCursor = await deps.db.meta.get(cursorKey);
  let cursor = parseStoredPullCursor(storedCursor?.value);
  const reconciliationIds = await listOutcomeUnknownMutationIds(deps.db, deps.storeId);
  const inventoryReconciliationIds = await listOutcomeUnknownInventoryMutationIds(
    deps.db,
    deps.storeId
  );
  let lastPayload: PullChangesResponse | null = null;

  for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
    const params = new URLSearchParams({ store_id: deps.storeId });
    if (cursor.since) params.set("since", cursor.since);
    if (cursor.salesAfterUpdatedAt && cursor.salesAfterId) {
      params.set("sales_after_updated_at", cursor.salesAfterUpdatedAt);
      params.set("sales_after_id", cursor.salesAfterId);
    }
    if (cursor.inventoryAfterUpdatedAt && cursor.inventoryAfterProductId) {
      params.set("inventory_after_updated_at", cursor.inventoryAfterUpdatedAt);
      params.set("inventory_after_product_id", cursor.inventoryAfterProductId);
    }
    if (cursor.inventoryAfterCreatedAt && cursor.inventoryAfterId) {
      params.set("inventory_after_created_at", cursor.inventoryAfterCreatedAt);
      params.set("inventory_after_id", cursor.inventoryAfterId);
    }
    for (const clientMutationId of reconciliationIds) {
      params.append("reconcile_id", clientMutationId);
    }
    for (const clientMutationId of inventoryReconciliationIds) {
      params.append("reconcile_inventory_id", clientMutationId);
    }
    const url = `${deps.pullChangesUrl ?? "/api/sync/changes"}?${params.toString()}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), deps.requestTimeoutMs ?? 20_000);
    let payload: PullChangesResponse | null = null;
    try {
      const response = await deps.fetchFn(url, {
        method: "GET",
        credentials: "include",
        signal: controller.signal,
      });
      const klass = classifySyncHttpStatus(response.status);
      if (klass === "end_session") {
        await deps.onEndSession?.();
        return null;
      }
      if (klass !== "success") return null;
      payload = parsePullChangesPayload(await readResponseJson(response, controller.signal));
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }

    if (!payload) return null;
    lastPayload = payload;
    const nextCursorValue =
      payload.nextCursor
        ? serializeStoredPullCursor(payload.nextCursor)
        : payload.serverTime;
    await applyPulledChanges(deps.db, deps.storeId, payload, cursorKey, nextCursorValue);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("pdv:inventory-sync"));
    }

    if (!payload.hasMore || !payload.nextCursor) {
      return payload;
    }
    cursor = payload.nextCursor;
  }

  return lastPayload;
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
  const [failedSales, failedInventory] = await Promise.all([
    db.outbox.where("status").equals("failed").count(),
    db.inventoryOutbox.where("status").equals("failed").count(),
  ]);
  const failedCount = failedSales + failedInventory;
  const conflicts = await listVisibleConflicts(db);
  return { pendingCount, failedCount, conflicts };
}

async function applyPushResponse(
  deps: SyncEngineDeps,
  clientMutationId: string,
  expectedProcessingUpdatedAt: string,
  response: Response,
  signal?: AbortSignal
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
  const body = await readJson(response, signal);
  const message = body.error ?? `HTTP ${response.status}`;
  if (klass === "success") {
    if (
      !body.sale_id ||
      !validateUuid(body.sale_id) ||
      body.client_mutation_id !== clientMutationId ||
      body.replay === undefined ||
      body.status !== "confirmed" ||
      body.stock_reconciled !== true
    ) {
      const responseError = !body.sale_id
        ? "missing sale_id"
        : !validateUuid(body.sale_id)
          ? "invalid sale_id"
          : "invalid process_sale response";
      await scheduleRetryOrResolve(
        deps,
        processing,
        responseError,
        true
      );
      return;
    }
    await reconcileSale(deps.db, clientMutationId, {
      sale_id: body.sale_id,
      status: body.status,
      total: body.total,
      stockReconciled: body.stock_reconciled,
      fiscalStatus: body.fiscalStatus,
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

async function applyInventoryPushResponse(
  deps: SyncEngineDeps,
  clientMutationId: string,
  expectedProcessingUpdatedAt: string,
  response: Response,
  signal?: AbortSignal
): Promise<void> {
  const processing = await getInventoryAdjustment(deps.db, clientMutationId);
  if (
    !processing ||
    processing.status !== "processing" ||
    processing.updatedAt !== expectedProcessingUpdatedAt
  ) {
    return;
  }

  const klass = classifySyncHttpStatus(response.status);
  const body = await readJson(response, signal);
  const message = body.error ?? `HTTP ${response.status}`;

  if (klass === "success") {
    if (
      !body.movement_id ||
      !validateUuid(body.movement_id) ||
      body.client_mutation_id !== clientMutationId ||
      !body.product_id ||
      body.product_id !== processing.productId ||
      body.replay === undefined ||
      typeof body.balance_after !== "string" ||
      typeof body.delta !== "string" ||
      typeof body.movement_type !== "string" ||
      !body.created_at ||
      Number.isNaN(Date.parse(body.created_at))
    ) {
      await scheduleInventoryRetryOrResolve(
        deps,
        processing,
        "invalid adjust_inventory response",
        true
      );
      return;
    }

    const movement: RemoteInventoryMovement = {
      id: body.movement_id,
      store_id: processing.storeId,
      product_id: body.product_id,
      client_mutation_id: body.client_mutation_id,
      terminal_id: typeof body.terminal_id === "string" ? body.terminal_id : undefined,
      import_id: typeof body.import_id === "string" ? body.import_id : undefined,
      import_row: typeof body.import_row === "number" ? body.import_row : undefined,
      movement_type: body.movement_type as RemoteInventoryMovement["movement_type"],
      quantity_change: body.delta,
      balance_after: body.balance_after,
      created_at: body.created_at,
    };
    await reconcileInventoryAdjustment(
      deps.db,
      movement,
      expectedProcessingUpdatedAt
    );
    return;
  }

  if (klass === "end_session") {
    await releaseInventoryAdjustment(
      deps.db,
      clientMutationId,
      deps.now?.() ?? new Date(),
      expectedProcessingUpdatedAt
    );
    await deps.onEndSession?.();
    return;
  }

  if (klass === "transient") {
    await scheduleInventoryRetryOrResolve(deps, processing, message, true);
    return;
  }

  if (klass === "conflict") {
    await recordInventoryConflict(deps.db, {
      clientMutationId,
      httpStatus: response.status,
      message,
      expectedProcessingUpdatedAt,
    });
    return;
  }

  await markInventoryAdjustmentFailed(deps.db, {
    clientMutationId,
    message,
    expectedProcessingUpdatedAt,
  });
}

async function scheduleInventoryRetryOrResolve(
  deps: SyncEngineDeps,
  processing: InventoryOutboxCommand,
  message: string,
  outcomeUnknown: boolean
): Promise<void> {
  const current = await getInventoryAdjustment(deps.db, processing.clientMutationId);
  if (
    !current ||
    current.status !== "processing" ||
    current.updatedAt !== processing.updatedAt
  ) {
    return;
  }

  if (shouldMarkOutboxFailed(current.attemptCount + 1)) {
    if (outcomeUnknown) {
      await markInventoryAdjustmentUncertain(deps.db, {
        clientMutationId: processing.clientMutationId,
        message,
        expectedProcessingUpdatedAt: processing.updatedAt,
      });
    } else {
      await markInventoryAdjustmentFailed(deps.db, {
        clientMutationId: processing.clientMutationId,
        message,
        expectedProcessingUpdatedAt: processing.updatedAt,
      });
    }
    return;
  }

  await scheduleInventoryAdjustmentRetry(
    deps.db,
    processing.clientMutationId,
    message,
    { now: deps.now?.() ?? new Date(), random: deps.random }
  );
}

async function applyPulledChanges(
  db: PdvLocalDatabase,
  storeId: string,
  payload: PullChangesResponse,
  cursorKey: string,
  nextCursorValue: string
): Promise<void> {
  for (const remoteSale of payload.sales) {
    if (remoteSale.status !== "confirmed") continue;
    const local = await db.sales.where("clientMutationId").equals(remoteSale.client_mutation_id).first();
    if (local && (local.syncStatus !== "synced" || local.stockReconciled !== true)) {
      await reconcileSale(db, remoteSale.client_mutation_id, {
        sale_id: remoteSale.id,
        status: remoteSale.status,
        total: normalizeMoneyValue(remoteSale.total),
        stockReconciled: true,
      });
    }
  }

  await db.transaction(
    "rw",
    [
      db.inventoryBalances,
      db.inventoryMovements,
      db.inventoryOutbox,
      db.sales,
      db.saleItems,
      db.outbox,
      db.payments,
      db.meta,
    ],
    async () => {
      const reserved = await pendingReservations(db, storeId);
      const pendingAdjustments = await pendingInventoryDeltas(db, storeId);
      for (const row of payload.inventory) {
        if (row.store_id !== storeId) continue;
        const serverQuantity = toInventoryQuantity(row.quantity);
        const reservedQty = toInventoryDifference(
          String(reserved.get(row.product_id) ?? "0")
        );
        const pendingDelta = pendingAdjustments.get(row.product_id) ?? "0.000";
        await db.inventoryBalances.put({
          storeId: row.store_id,
          productId: row.product_id,
          serverQuantity,
          quantity: projectInventoryQuantity(
            serverQuantity,
            pendingDelta,
            reservedQty
          ),
          updatedAt: row.updated_at,
        });
      }

      for (const movement of payload.inventoryMovements) {
        if (movement.store_id !== storeId) continue;
        await db.inventoryMovements.put({
          id: movement.id,
          storeId: movement.store_id,
          productId: movement.product_id,
          clientMutationId: movement.client_mutation_id,
          terminalId: movement.terminal_id,
          importId: movement.import_id,
          importRow: movement.import_row,
          movementType: movement.movement_type,
          quantityChange: toInventoryDifference(movement.quantity_change),
          balanceAfter: toInventoryQuantity(movement.balance_after),
          createdAt: movement.created_at,
        });
      }

      await db.meta.put({ key: cursorKey, value: nextCursorValue });
    }
  );

  for (const movement of payload.inventoryMovements) {
    if (!movement.client_mutation_id || movement.store_id !== storeId) continue;
    const command = await getInventoryAdjustment(db, movement.client_mutation_id);
    if (
      !command ||
      (command.status !== "pending" &&
        command.status !== "processing" &&
        !(command.status === "conflict" && command.outcomeUnknown === true))
    ) {
      continue;
    }
    const snapshot = payload.inventory.find(
      (row) =>
        row.store_id === movement.store_id &&
        row.product_id === movement.product_id
    );
    await reconcileInventoryAdjustment(db, movement, undefined, snapshot?.quantity);
  }
}

async function pendingReservations(
  db: PdvLocalDatabase,
  storeId: string,
  excludeSaleId?: string
): Promise<Map<string, string>> {
  const sales = await db.sales.where("storeId").equals(storeId).toArray();
  const active = sales.filter(
    (sale) =>
      sale.id !== excludeSaleId &&
      (sale.syncStatus === "pending" ||
        sale.syncStatus === "processing" ||
        (sale.syncStatus === "synced" && sale.stockReconciled !== true))
  );
  const reserved = new Map<string, string>();
  for (const sale of active) {
    const items = await db.saleItems.where("saleId").equals(sale.id).toArray();
    for (const item of items) {
      reserved.set(
        item.productId,
        addInventoryDifferences(
          reserved.get(item.productId) ?? "0.000",
          toInventoryDelta(item.quantity)
        )
      );
    }
  }
  return reserved;
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
    const serverQuantity = toInventoryQuantity(
      balance?.serverQuantity ?? balance?.quantity ?? "0.000"
    );
    await db.inventoryBalances.put({
      storeId: sale.storeId,
      productId,
      quantity: projectInventoryQuantity(
        serverQuantity,
        "0.000",
        reserved.get(productId) ?? "0.000"
      ),
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
        const payments = await db.payments.where("saleId").equals(currentOutbox.saleId).toArray();
        for (const payment of payments) {
          if (payment.status === "pending" || payment.status === "authorized") {
            await db.payments.put({ ...payment, status: "unknown" });
          }
        }
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
            outcomeUnknown: true,
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

async function readJson(response: Response, signal?: AbortSignal): Promise<{
  error?: string;
  sale_id?: string;
  client_mutation_id?: string;
  replay?: boolean;
  status?: string;
  total?: string;
  stock_reconciled?: boolean;
  fiscalStatus?: FiscalStatus;
  movement_id?: string;
  product_id?: string;
  terminal_id?: string;
  import_id?: string;
  import_row?: number;
  movement_type?: string;
  created_at?: string;
  balance_after?: string;
  delta?: string;
}> {
  try {
    const value = await readResponseJson(response, signal);
    if (!value || typeof value !== "object") return {};
    const body = value as Record<string, unknown>;
    return {
      error: typeof body.error === "string" ? body.error : undefined,
      sale_id: typeof body.sale_id === "string" ? body.sale_id : undefined,
      client_mutation_id:
        typeof body.client_mutation_id === "string" ? body.client_mutation_id : undefined,
      replay: typeof body.replay === "boolean" ? body.replay : undefined,
      status: typeof body.status === "string" ? body.status : undefined,
      total: normalizeMoneyValue(body.total),
      stock_reconciled:
        typeof body.stock_reconciled === "boolean" ? body.stock_reconciled : undefined,
      fiscalStatus: parseFiscalStatus(
        typeof body.fiscal === "object" && body.fiscal !== null
          ? (body.fiscal as Record<string, unknown>).status
          : undefined
      ),
      movement_id: typeof body.movement_id === "string" ? body.movement_id : undefined,
      product_id: typeof body.product_id === "string" ? body.product_id : undefined,
      terminal_id: typeof body.terminal_id === "string" ? body.terminal_id : undefined,
      import_id: typeof body.import_id === "string" ? body.import_id : undefined,
      import_row: typeof body.import_row === "number" ? body.import_row : undefined,
      movement_type:
        typeof body.movement_type === "string" ? body.movement_type : undefined,
      created_at: typeof body.created_at === "string" ? body.created_at : undefined,
      balance_after:
        typeof body.balance_after === "string" ? body.balance_after : undefined,
      delta: typeof body.delta === "string" ? body.delta : undefined,
    };
  } catch {
    return {};
  }
}

function parseFiscalStatus(value: unknown): FiscalStatus | undefined {
  return typeof value === "string" &&
    (FISCAL_STATUSES as readonly string[]).includes(value)
    ? (value as FiscalStatus)
    : undefined;
}

async function readResponseJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  const json = response.json().catch(() => undefined);
  if (!signal) return json;
  if (signal.aborted) return undefined;

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<undefined>((resolve) => {
    onAbort = () => resolve(undefined);
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    return await Promise.race([json, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

function parseStoredPullCursor(value?: string): PullCursor {
  if (!value) return { since: null };

  try {
    const parsed: unknown = JSON.parse(value);
    const cursor = parsePullCursor(parsed);
    if (cursor) return cursor;
  } catch {
    // Legacy cursors are plain ISO timestamps.
  }

  return Number.isNaN(Date.parse(value)) ? { since: null } : { since: value };
}

function serializeStoredPullCursor(cursor: NonNullable<PullChangesResponse["nextCursor"]>): string {
  return JSON.stringify({
    since: cursor.since,
    sales_after_updated_at: cursor.salesAfterUpdatedAt,
    sales_after_id: cursor.salesAfterId,
    inventory_after_updated_at: cursor.inventoryAfterUpdatedAt,
    inventory_after_product_id: cursor.inventoryAfterProductId,
    inventory_after_created_at: cursor.inventoryAfterCreatedAt,
    inventory_after_id: cursor.inventoryAfterId,
  });
}

function parsePullCursor(value: unknown): PullChangesResponse["nextCursor"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const cursor = value as Record<string, unknown>;
  if (
    (cursor.since !== null &&
      cursor.since !== undefined &&
      (typeof cursor.since !== "string" || Number.isNaN(Date.parse(cursor.since)))) ||
    (cursor.sales_after_updated_at !== undefined &&
      (typeof cursor.sales_after_updated_at !== "string" ||
        Number.isNaN(Date.parse(cursor.sales_after_updated_at)))) ||
    (cursor.sales_after_id !== undefined &&
      (typeof cursor.sales_after_id !== "string" ||
        !validateUuid(cursor.sales_after_id))) ||
    (cursor.inventory_after_updated_at !== undefined &&
      (typeof cursor.inventory_after_updated_at !== "string" ||
        Number.isNaN(Date.parse(cursor.inventory_after_updated_at)))) ||
    (cursor.inventory_after_product_id !== undefined &&
      (typeof cursor.inventory_after_product_id !== "string" ||
        !validateUuid(cursor.inventory_after_product_id))) ||
    (cursor.inventory_after_created_at !== undefined &&
      (typeof cursor.inventory_after_created_at !== "string" ||
        Number.isNaN(Date.parse(cursor.inventory_after_created_at)))) ||
    (cursor.inventory_after_id !== undefined &&
      (typeof cursor.inventory_after_id !== "string" ||
        !validateUuid(cursor.inventory_after_id)))
  ) {
    return undefined;
  }
  if (
    Boolean(cursor.sales_after_updated_at) !== Boolean(cursor.sales_after_id) ||
    Boolean(cursor.inventory_after_updated_at) !==
      Boolean(cursor.inventory_after_product_id) ||
    Boolean(cursor.inventory_after_created_at) !== Boolean(cursor.inventory_after_id)
  ) {
    return undefined;
  }

  return {
    since: (cursor.since as string | null | undefined) ?? null,
    salesAfterUpdatedAt:
      typeof cursor.sales_after_updated_at === "string"
        ? cursor.sales_after_updated_at
        : undefined,
    salesAfterId:
      typeof cursor.sales_after_id === "string" ? cursor.sales_after_id : undefined,
    inventoryAfterUpdatedAt:
      typeof cursor.inventory_after_updated_at === "string"
        ? cursor.inventory_after_updated_at
        : undefined,
    inventoryAfterProductId:
      typeof cursor.inventory_after_product_id === "string"
        ? cursor.inventory_after_product_id
        : undefined,
    inventoryAfterCreatedAt:
      typeof cursor.inventory_after_created_at === "string"
        ? cursor.inventory_after_created_at
        : undefined,
    inventoryAfterId:
      typeof cursor.inventory_after_id === "string"
        ? cursor.inventory_after_id
        : undefined,
  };
}

async function listOutcomeUnknownMutationIds(db: PdvLocalDatabase, storeId: string): Promise<string[]> {
  const commands = await db.outbox.where("status").equals("conflict").toArray();
  return commands
    .filter((command) => command.storeId === storeId && command.outcomeUnknown === true)
    .map((command) => command.clientMutationId)
    .slice(0, 50);
}

async function listOutcomeUnknownInventoryMutationIds(
  db: PdvLocalDatabase,
  storeId: string
): Promise<string[]> {
  const commands = await db.inventoryOutbox
    .where("status")
    .equals("conflict")
    .toArray();
  return commands
    .filter(
      (command) =>
        command.storeId === storeId && command.outcomeUnknown === true
    )
    .map((command) => command.clientMutationId)
    .slice(0, 50);
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

function normalizeQuantityValue(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  try {
    return toInventoryQuantity(value);
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
  const hasMore = payload.has_more === true;
  const nextCursor = payload.next_cursor
    ? parsePullCursor(payload.next_cursor)
    : undefined;
  if (hasMore && !nextCursor) return null;

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

  const inventoryMovements: PullChangesResponse["inventoryMovements"] = [];
  const rawInventoryMovements = Array.isArray(payload.inventory_movements)
    ? payload.inventory_movements
    : [];
  for (const value of rawInventoryMovements) {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    const quantityChange =
      typeof row.quantity_change === "string" ||
      typeof row.quantity_change === "number"
        ? normalizeSignedQuantityValue(row.quantity_change)
        : undefined;
    const balanceAfter = normalizeQuantityValue(row.balance_after);
    if (
      typeof row.id !== "string" ||
      !validateUuid(row.id) ||
      typeof row.store_id !== "string" ||
      !validateUuid(row.store_id) ||
      typeof row.product_id !== "string" ||
      !validateUuid(row.product_id) ||
      typeof row.movement_type !== "string" ||
      !["sale", "refund", "restock", "adjustment"].includes(row.movement_type) ||
      quantityChange === undefined ||
      balanceAfter === undefined ||
      typeof row.created_at !== "string" ||
      Number.isNaN(Date.parse(row.created_at))
    ) {
      return null;
    }
    if (
      row.client_mutation_id !== undefined &&
      (typeof row.client_mutation_id !== "string" ||
        !validateUuid(row.client_mutation_id))
    ) {
      return null;
    }
    if (
      row.terminal_id !== undefined &&
      (typeof row.terminal_id !== "string" || !validateUuid(row.terminal_id))
    ) {
      return null;
    }
    if (
      row.import_id !== undefined &&
      (typeof row.import_id !== "string" || !validateUuid(row.import_id))
    ) {
      return null;
    }
    if (
      row.import_row !== undefined &&
      (typeof row.import_row !== "number" ||
        !Number.isInteger(row.import_row) ||
        row.import_row <= 0)
    ) {
      return null;
    }
    inventoryMovements.push({
      id: row.id,
      store_id: row.store_id,
      product_id: row.product_id,
      client_mutation_id:
        typeof row.client_mutation_id === "string"
          ? row.client_mutation_id
          : undefined,
      terminal_id:
        typeof row.terminal_id === "string" ? row.terminal_id : undefined,
      import_id: typeof row.import_id === "string" ? row.import_id : undefined,
      import_row: typeof row.import_row === "number" ? row.import_row : undefined,
      movement_type:
        row.movement_type as PullChangesResponse["inventoryMovements"][number]["movement_type"],
      quantity_change: quantityChange,
      balance_after: balanceAfter,
      created_at: row.created_at,
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
    hasMore,
    nextCursor,
    inventory,
    inventoryMovements,
    sales,
  };
}

function normalizeSignedQuantityValue(value: string | number): string | undefined {
  try {
    return toInventoryDifference(value);
  } catch {
    return undefined;
  }
}

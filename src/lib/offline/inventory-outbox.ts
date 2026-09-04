import { backoffDelayMs, shouldMarkOutboxFailed } from "@/lib/offline/backoff";
import type { PdvLocalDatabase } from "@/lib/offline/pdv-local-db";
import type {
  InventoryOutboxCommand,
  LocalSyncStatus,
} from "@/lib/offline/types";

const TERMINAL_STATUSES = new Set<LocalSyncStatus>([
  "synced",
  "conflict",
  "failed",
]);

export async function listDueInventoryAdjustments(
  db: PdvLocalDatabase,
  now: Date = new Date(),
  storeId?: string | null
): Promise<InventoryOutboxCommand[]> {
  const due = await db.inventoryOutbox
    .where("status")
    .equals("pending")
    .toArray();
  return due
    .filter(
      (command) =>
        (!storeId || command.storeId === storeId) &&
        command.nextAttemptAt <= now.toISOString()
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function resetStuckInventoryAdjustments(
  db: PdvLocalDatabase,
  now: Date = new Date(),
  stuckAfterMs = 30_000,
  storeId?: string | null
): Promise<void> {
  const stuckBefore = new Date(now.getTime() - stuckAfterMs).toISOString();
  const processing = (await db.inventoryOutbox
    .where("status")
    .equals("processing")
    .toArray()
  ).filter((command) => !storeId || command.storeId === storeId);

  for (const command of processing) {
    if (command.updatedAt <= stuckBefore) {
      await replaceInventoryOutbox(db, command, {
        ...command,
        status: "pending",
        updatedAt: now.toISOString(),
      });
    }
  }
}

export async function claimInventoryAdjustment(
  db: PdvLocalDatabase,
  clientMutationId: string,
  expectedUpdatedAt: string,
  now: Date = new Date()
): Promise<InventoryOutboxCommand | null> {
  return db.transaction("rw", db.inventoryOutbox, async () => {
    const existing = await db.inventoryOutbox.get(clientMutationId);
    if (
      !existing ||
      existing.status !== "pending" ||
      existing.updatedAt !== expectedUpdatedAt ||
      existing.payload.client_mutation_id !== clientMutationId
    ) {
      return null;
    }

    const next: InventoryOutboxCommand = {
      ...existing,
      status: "processing",
      updatedAt: now.toISOString(),
    };
    assertStatusTransition(existing.status, next.status);
    await db.inventoryOutbox.put(next);
    return next;
  });
}

export async function getInventoryAdjustment(
  db: PdvLocalDatabase,
  clientMutationId: string
): Promise<InventoryOutboxCommand | undefined> {
  return db.inventoryOutbox.get(clientMutationId);
}

export async function scheduleInventoryAdjustmentRetry(
  db: PdvLocalDatabase,
  clientMutationId: string,
  lastError: string,
  options?: { now?: Date; random?: () => number }
): Promise<InventoryOutboxCommand> {
  const existing = await requireInventoryAdjustment(db, clientMutationId);
  const attemptCount = existing.attemptCount + 1;
  const now = options?.now ?? new Date();
  const failed = shouldMarkOutboxFailed(attemptCount);
  const nextAttemptAt = failed
    ? existing.nextAttemptAt
    : new Date(
        now.getTime() + backoffDelayMs(attemptCount - 1, options?.random)
      ).toISOString();

  return replaceInventoryOutbox(db, existing, {
    ...existing,
    status: failed ? "failed" : "pending",
    attemptCount,
    lastError,
    nextAttemptAt,
    updatedAt: now.toISOString(),
  });
}

export async function releaseInventoryAdjustment(
  db: PdvLocalDatabase,
  clientMutationId: string,
  now: Date = new Date(),
  expectedUpdatedAt?: string
): Promise<InventoryOutboxCommand> {
  const existing = await requireInventoryAdjustment(db, clientMutationId);
  if (
    existing.status !== "processing" ||
    (expectedUpdatedAt !== undefined && existing.updatedAt !== expectedUpdatedAt)
  ) {
    return existing;
  }
  return replaceInventoryOutbox(db, existing, {
    ...existing,
    status: "pending",
    updatedAt: now.toISOString(),
  });
}

export async function markInventoryAdjustmentSynced(
  db: PdvLocalDatabase,
  clientMutationId: string,
  now: Date = new Date(),
  expectedUpdatedAt?: string
): Promise<InventoryOutboxCommand> {
  const existing = await requireInventoryAdjustment(db, clientMutationId);
  if (
    expectedUpdatedAt !== undefined &&
    (existing.status !== "processing" || existing.updatedAt !== expectedUpdatedAt)
  ) {
    return existing;
  }
  return replaceInventoryOutbox(db, existing, {
    ...existing,
    status: "synced",
    lastError: undefined,
    outcomeUnknown: undefined,
    updatedAt: now.toISOString(),
  });
}

async function requireInventoryAdjustment(
  db: PdvLocalDatabase,
  clientMutationId: string
): Promise<InventoryOutboxCommand> {
  const existing = await db.inventoryOutbox.get(clientMutationId);
  if (!existing) {
    throw new Error(`Inventory outbox command not found: ${clientMutationId}`);
  }
  return existing;
}

async function replaceInventoryOutbox(
  db: PdvLocalDatabase,
  previous: InventoryOutboxCommand,
  next: InventoryOutboxCommand
): Promise<InventoryOutboxCommand> {
  return db.transaction("rw", db.inventoryOutbox, async () => {
    const current = await db.inventoryOutbox.get(previous.clientMutationId);
    if (!current) {
      throw new Error(
        `Inventory outbox command not found: ${previous.clientMutationId}`
      );
    }
    if (
      current.clientMutationId !== next.clientMutationId ||
      next.payload.client_mutation_id !== current.clientMutationId
    ) {
      throw new Error(
        "clientMutationId is immutable; retry must not recreate the outbox key"
      );
    }
    if (
      current.status !== previous.status ||
      current.updatedAt !== previous.updatedAt ||
      current.attemptCount !== previous.attemptCount ||
      current.nextAttemptAt !== previous.nextAttemptAt
    ) {
      return current;
    }
    assertStatusTransition(current.status, next.status);
    await db.inventoryOutbox.put(next);
    return next;
  });
}

function assertStatusTransition(
  previous: LocalSyncStatus,
  next: LocalSyncStatus
): void {
  if (previous === next) return;
  if (TERMINAL_STATUSES.has(previous)) {
    throw new Error(
      `Invalid inventory outbox status transition: ${previous} -> ${next}`
    );
  }
  if (previous === "pending" && next === "processing") return;
  if (
    previous === "processing" &&
    (next === "pending" || TERMINAL_STATUSES.has(next))
  ) {
    return;
  }
  throw new Error(
    `Invalid inventory outbox status transition: ${previous} -> ${next}`
  );
}

import { backoffDelayMs, shouldMarkOutboxFailed } from "@/lib/offline/backoff";
import type { PdvLocalDatabase } from "@/lib/offline/pdv-local-db";
import type { LocalSyncStatus, OutboxCommand } from "@/lib/offline/types";

const TERMINAL_STATUSES = new Set<LocalSyncStatus>(["synced", "conflict", "failed"]);

function assertStatusTransition(previous: LocalSyncStatus, next: LocalSyncStatus): void {
  if (previous === next) return;
  if (TERMINAL_STATUSES.has(previous)) {
    throw new Error(`Invalid outbox status transition: ${previous} -> ${next}`);
  }
  if (previous === "pending" && next === "processing") return;
  if (previous === "processing" && (next === "pending" || TERMINAL_STATUSES.has(next))) return;
  throw new Error(`Invalid outbox status transition: ${previous} -> ${next}`);
}

export function assertImmutableClientMutationId(previous: string, next: string): void {
  if (previous !== next) {
    throw new Error("clientMutationId is immutable; retry must not recreate the outbox key");
  }
}

export async function getOutboxCommand(
  db: PdvLocalDatabase,
  clientMutationId: string
): Promise<OutboxCommand | undefined> {
  return db.outbox.get(clientMutationId);
}

export async function listDueOutboxCommands(
  db: PdvLocalDatabase,
  now: Date = new Date(),
  storeId?: string | null
): Promise<OutboxCommand[]> {
  const nowIso = now.toISOString();
  const pending = await db.outbox.where("status").equals("pending").toArray();
  return pending
    .filter(
      (command) =>
        (!storeId || command.storeId === storeId) &&
        command.nextAttemptAt <= nowIso
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function resetStuckProcessing(
  db: PdvLocalDatabase,
  now: Date = new Date(),
  stuckAfterMs = 30_000,
  storeId?: string | null
): Promise<void> {
  const stuckBefore = new Date(now.getTime() - stuckAfterMs).toISOString();
  const processing = (await db.outbox.where("status").equals("processing").toArray()).filter(
    (command) => !storeId || command.storeId === storeId
  );
  for (const command of processing) {
    if (command.updatedAt <= stuckBefore) {
      await replaceOutbox(db, command, {
        ...command,
        status: "pending",
        updatedAt: now.toISOString(),
      });
    }
  }
}

export async function markOutboxProcessing(
  db: PdvLocalDatabase,
  clientMutationId: string,
  now: Date = new Date()
): Promise<OutboxCommand> {
  const existing = await requireOutbox(db, clientMutationId);
  return replaceOutbox(db, existing, {
    ...existing,
    status: "processing",
    updatedAt: now.toISOString(),
  });
}

export async function claimOutboxProcessing(
  db: PdvLocalDatabase,
  clientMutationId: string,
  expectedUpdatedAt: string,
  now: Date = new Date()
): Promise<OutboxCommand | null> {
  return db.transaction("rw", db.outbox, async () => {
    const existing = await db.outbox.get(clientMutationId);
    if (
      !existing ||
      existing.status !== "pending" ||
      existing.updatedAt !== expectedUpdatedAt ||
      existing.payload.client_mutation_id !== clientMutationId
    ) {
      return null;
    }

    const next: OutboxCommand = {
      ...existing,
      status: "processing",
      updatedAt: now.toISOString(),
    };
    assertStatusTransition(existing.status, next.status);
    await db.outbox.put(next);
    return next;
  });
}

export async function scheduleOutboxRetry(
  db: PdvLocalDatabase,
  clientMutationId: string,
  lastError: string,
  options?: { now?: Date; random?: () => number }
): Promise<OutboxCommand> {
  const existing = await requireOutbox(db, clientMutationId);
  const attemptCount = existing.attemptCount + 1;
  const now = options?.now ?? new Date();
  const failed = shouldMarkOutboxFailed(attemptCount);
  const nextAttemptAt = failed
    ? existing.nextAttemptAt
    : new Date(now.getTime() + backoffDelayMs(attemptCount - 1, options?.random)).toISOString();

  return replaceOutbox(db, existing, {
    ...existing,
    status: failed ? "failed" : "pending",
    attemptCount,
    lastError,
    nextAttemptAt,
    updatedAt: now.toISOString(),
  });
}

export async function markOutboxSynced(
  db: PdvLocalDatabase,
  clientMutationId: string,
  now: Date = new Date()
): Promise<OutboxCommand> {
  const existing = await requireOutbox(db, clientMutationId);
  return replaceOutbox(db, existing, {
    ...existing,
    status: "synced",
    lastError: undefined,
    updatedAt: now.toISOString(),
  });
}

export async function markOutboxConflict(
  db: PdvLocalDatabase,
  clientMutationId: string,
  lastError: string,
  now: Date = new Date()
): Promise<OutboxCommand> {
  const existing = await requireOutbox(db, clientMutationId);
  return replaceOutbox(db, existing, {
    ...existing,
    status: "conflict",
    lastError,
    updatedAt: now.toISOString(),
  });
}

export async function releaseOutboxProcessing(
  db: PdvLocalDatabase,
  clientMutationId: string,
  now: Date = new Date(),
  expectedUpdatedAt?: string
): Promise<OutboxCommand> {
  const existing = await requireOutbox(db, clientMutationId);
  if (
    existing.status !== "processing" ||
    (expectedUpdatedAt !== undefined && existing.updatedAt !== expectedUpdatedAt)
  ) {
    return existing;
  }
  return replaceOutbox(db, existing, {
    ...existing,
    status: "pending",
    updatedAt: now.toISOString(),
  });
}

export async function markOutboxFailed(
  db: PdvLocalDatabase,
  clientMutationId: string,
  lastError: string,
  now: Date = new Date()
): Promise<OutboxCommand> {
  const existing = await requireOutbox(db, clientMutationId);
  return replaceOutbox(db, existing, {
    ...existing,
    status: "failed",
    lastError,
    updatedAt: now.toISOString(),
  });
}

async function requireOutbox(db: PdvLocalDatabase, clientMutationId: string): Promise<OutboxCommand> {
  const existing = await db.outbox.get(clientMutationId);
  if (!existing) {
    throw new Error(`Outbox command not found: ${clientMutationId}`);
  }
  return existing;
}

async function replaceOutbox(
  db: PdvLocalDatabase,
  previous: OutboxCommand,
  next: OutboxCommand
): Promise<OutboxCommand> {
  return db.transaction("rw", db.outbox, async () => {
    const current = await db.outbox.get(previous.clientMutationId);
    if (!current) {
      throw new Error(`Outbox command not found: ${previous.clientMutationId}`);
    }
    assertImmutableClientMutationId(current.clientMutationId, next.clientMutationId);
    if (next.payload.client_mutation_id !== current.clientMutationId) {
      throw new Error("clientMutationId is immutable; retry must not recreate the outbox key");
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
    await db.outbox.put(next);
    return next;
  });
}

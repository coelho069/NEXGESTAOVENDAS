/**
 * Operational recovery invariants for local-first + server idempotency.
 * These helpers are pure so unit tests can assert restart/replay safety
 * without spinning infrastructure.
 */

export type OutboxRecoveryState = {
  status: "pending" | "processing" | "failed" | "conflict" | "synced";
  attemptCount: number;
  clientMutationId: string;
  nextAttemptAt?: string | null;
  outcomeUnknown?: boolean;
};

export function canSafelyRetryOutbox(command: OutboxRecoveryState, nowIso: string): boolean {
  if (command.status === "synced" || command.status === "conflict") return false;
  if (command.status === "failed") return false;
  if (command.status === "processing") {
    // Stale processing leases are reclaimable by the sync engine; this helper
    // only answers "is a deliberate retry allowed for pending work".
    return false;
  }
  if (!command.nextAttemptAt) return true;
  return Date.parse(command.nextAttemptAt) <= Date.parse(nowIso);
}

export function assertSingleFinancialEffect(input: {
  localWrites: number;
  serverReplay: boolean;
  expectedWrites: number;
}): boolean {
  if (input.serverReplay) return input.localWrites === input.expectedWrites;
  return input.localWrites === input.expectedWrites;
}

export type BackupRecoveryLimitation = {
  automatedBackup: false;
  rpo: "depends_on_operator_snapshots";
  rto: "manual_restore";
  notes: string[];
};

export function describeBackupRecoveryLimitations(): BackupRecoveryLimitation {
  return {
    automatedBackup: false,
    rpo: "depends_on_operator_snapshots",
    rto: "manual_restore",
    notes: [
      "Application recovery relies on Postgres backups operated outside the app (Supabase/PITR or VM snapshots).",
      "Local IndexedDB outbox survives process restart and retries with the same client_mutation_id.",
      "Fiscal integration_outbox is durable server-side and is reclaimed by the worker after crash.",
      "No in-app automated backup/restore orchestration is provided in Bloqueador 11.",
    ],
  };
}

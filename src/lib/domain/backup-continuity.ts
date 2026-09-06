/**
 * B26 — Backup, recovery and operational continuity contracts.
 *
 * The application does NOT orchestrate Postgres backups. Status fields below
 * are honest: without operator attestation they remain unknown / not ready.
 * Never invent `backup_success`, timestamps, or PITR confirmation.
 */

export const CRITICAL_RECOVERY_ENTITIES = [
  "organizations",
  "stores",
  "profiles",
  "store_members",
  "products",
  "inventory_balances",
  "inventory_movements",
  "sales",
  "sale_items",
  "payments",
  "cash_sessions",
  "cash_movements",
  "customers",
  "fiscal_documents",
  "integration_outbox",
  "store_settings",
  "audit_logs",
  "idempotency_keys",
] as const;

export type CriticalRecoveryEntity = (typeof CRITICAL_RECOVERY_ENTITIES)[number];

/** Layers that must be restored independently and validated separately. */
export const RECOVERY_LAYERS = [
  "database",
  "application",
  "configuration",
  "secrets",
  "outbox_reprocess",
] as const;

export type RecoveryLayer = (typeof RECOVERY_LAYERS)[number];

export type BackupAvailability = "unknown" | "attested" | "failed";

export type BackupContinuityStatus = {
  /** Always false in-app: backups are operator/provider managed. */
  automatedBackupOrchestratedByApp: false;
  backup_available: BackupAvailability;
  /** ISO timestamp only when the operator attested a real drill/verify. */
  backup_last_verified: string | null;
  backup_status: "unverified" | "verified" | "failed" | "operator_managed";
  recovery_ready: boolean;
  deliverySemantics: "at-least-once-outbox-retry";
  sourceOfTruth: "postgres";
  localStateRole: "terminal_cache_and_outbox_not_corporate_backup";
  notes: string[];
};

export type OperatorBackupAttestation = {
  /** Operator-supplied status after a real backup/restore drill. */
  status?: string | null;
  /** Operator-supplied ISO-8601 verification time. Never invent. */
  lastVerifiedAt?: string | null;
};

const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export function isValidBackupAttestationTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  if (!ISO_TIMESTAMP.test(value.trim())) return false;
  const ms = Date.parse(value.trim());
  return Number.isFinite(ms);
}

/**
 * Resolve public backup continuity status without inventing success.
 * Unset attestation ⇒ operator_managed / unknown / recovery_ready=false.
 */
export function resolveBackupContinuityStatus(
  attestation: OperatorBackupAttestation = {}
): BackupContinuityStatus {
  const baseNotes = [
    "Postgres is the source of truth; IndexedDB/outbox is not a corporate backup.",
    "Retry of outbox commands uses the same client_mutation_id (at-least-once delivery, server idempotency).",
    "Application does not run pg_dump/PITR; operator/provider must.",
    "RPO/RTO depend on Supabase PITR/snapshots — not claimed as tested here unless attested.",
  ];

  const rawStatus = (attestation.status ?? "").trim().toLowerCase();
  const verifiedAt = attestation.lastVerifiedAt?.trim() ?? null;

  if (rawStatus === "failed") {
    return {
      automatedBackupOrchestratedByApp: false,
      backup_available: "failed",
      backup_last_verified: isValidBackupAttestationTimestamp(verifiedAt) ? verifiedAt : null,
      backup_status: "failed",
      recovery_ready: false,
      deliverySemantics: "at-least-once-outbox-retry",
      sourceOfTruth: "postgres",
      localStateRole: "terminal_cache_and_outbox_not_corporate_backup",
      notes: [...baseNotes, "Operator attested backup/restore failure."],
    };
  }

  if (rawStatus === "verified") {
    if (!isValidBackupAttestationTimestamp(verifiedAt)) {
      return {
        automatedBackupOrchestratedByApp: false,
        backup_available: "unknown",
        backup_last_verified: null,
        backup_status: "unverified",
        recovery_ready: false,
        deliverySemantics: "at-least-once-outbox-retry",
        sourceOfTruth: "postgres",
        localStateRole: "terminal_cache_and_outbox_not_corporate_backup",
        notes: [
          ...baseNotes,
          "BACKUP_STATUS=verified was set without a valid BACKUP_LAST_VERIFIED_AT; treated as unverified.",
        ],
      };
    }
    return {
      automatedBackupOrchestratedByApp: false,
      backup_available: "attested",
      backup_last_verified: verifiedAt,
      backup_status: "verified",
      recovery_ready: true,
      deliverySemantics: "at-least-once-outbox-retry",
      sourceOfTruth: "postgres",
      localStateRole: "terminal_cache_and_outbox_not_corporate_backup",
      notes: [
        ...baseNotes,
        "Operator attested a successful backup/restore drill; app did not execute the backup itself.",
      ],
    };
  }

  return {
    automatedBackupOrchestratedByApp: false,
    backup_available: "unknown",
    backup_last_verified: null,
    backup_status: "operator_managed",
    recovery_ready: false,
    deliverySemantics: "at-least-once-outbox-retry",
    sourceOfTruth: "postgres",
    localStateRole: "terminal_cache_and_outbox_not_corporate_backup",
    notes: baseNotes,
  };
}

export function readOperatorBackupAttestationFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): OperatorBackupAttestation {
  return {
    status: env.BACKUP_STATUS ?? null,
    lastVerifiedAt: env.BACKUP_LAST_VERIFIED_AT ?? null,
  };
}

/** Recovery runbook steps required by B26 (order matters). */
export const RECOVERY_RUNBOOK_STEPS = [
  "prerequisites",
  "identify_failure",
  "protect_data",
  "restore",
  "validate_restore",
  "smoke_tests",
  "validate_rls",
  "validate_migrations",
  "validate_integrity",
  "return_to_service",
] as const;

export type RecoveryRunbookStep = (typeof RECOVERY_RUNBOOK_STEPS)[number];

export type IdempotentRetryKind = "sale" | "payment" | "inventory_movement" | "cash_movement" | "fiscal";

/**
 * Server authority invariant: retry with the same mutation id must not create
 * a second financial/stock effect. Local offline is not a second source of truth.
 */
export function assertRetryDoesNotDuplicate(input: {
  kind: IdempotentRetryKind;
  clientMutationId: string;
  previousServerEffectCount: number;
  replay: boolean;
}): { ok: true } | { ok: false; code: "duplicate_effect_risk"; message: string } {
  if (!input.clientMutationId.trim()) {
    return {
      ok: false,
      code: "duplicate_effect_risk",
      message: "client_mutation_id ausente; retry inseguro.",
    };
  }
  if (input.replay && input.previousServerEffectCount !== 1) {
    return {
      ok: false,
      code: "duplicate_effect_risk",
      message: `Replay de ${input.kind} sem efeito único no servidor (count=${input.previousServerEffectCount}).`,
    };
  }
  if (!input.replay && input.previousServerEffectCount > 1) {
    return {
      ok: false,
      code: "duplicate_effect_risk",
      message: `Efeitos duplicados detectados para ${input.kind}.`,
    };
  }
  return { ok: true };
}

/**
 * Reject restore/admin inputs that look like shell injection or path traversal.
 * Recovery scripts must never exec(user_input).
 */
export function assertSafeRecoveryAdminInput(value: unknown): {
  ok: true;
  value: string;
} | {
  ok: false;
  code: "unsafe_recovery_input";
  message: string;
} {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, code: "unsafe_recovery_input", message: "Input de recovery vazio." };
  }
  const trimmed = value.trim();
  if (trimmed.length > 512) {
    return { ok: false, code: "unsafe_recovery_input", message: "Input de recovery excede limite." };
  }
  if (
    /[;&|`$<>]/.test(trimmed) ||
    /\b(?:sh|bash|cmd|powershell|exec|spawn|system)\b/i.test(trimmed) ||
    trimmed.includes("..") ||
    trimmed.includes("\0")
  ) {
    return {
      ok: false,
      code: "unsafe_recovery_input",
      message: "Input de recovery rejeitado (shell/path injection).",
    };
  }
  return { ok: true, value: trimmed };
}

export function rejectRecoveryShellExecution(userInput: string): never {
  void userInput;
  throw new Error("recovery_shell_execution_rejected");
}

/** Secrets that must never appear in NEXT_PUBLIC_* or versioned backups. */
export const RECOVERY_FORBIDDEN_PUBLIC_ENV_KEYS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "FISCAL_PROVIDER_API_KEY",
  "PAYMENT_PROVIDER_API_KEY",
  "FISCAL_WORKER_SECRET",
  "DATABASE_URL",
] as const;

export function assertNoPublicSecretLeak(
  env: Record<string, string | undefined>
): { ok: true } | { ok: false; leaked: string[] } {
  const leaked: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("NEXT_PUBLIC_")) continue;
    if (!value) continue;
    const upper = key.toUpperCase();
    if (
      upper.includes("SERVICE_ROLE") ||
      upper.includes("SECRET") ||
      upper.includes("PASSWORD") ||
      upper.includes("PRIVATE") ||
      upper.endsWith("_API_KEY")
    ) {
      leaked.push(key);
    }
  }
  for (const forbidden of RECOVERY_FORBIDDEN_PUBLIC_ENV_KEYS) {
    const publicAlias = `NEXT_PUBLIC_${forbidden}`;
    if (env[publicAlias]) leaked.push(publicAlias);
  }
  return leaked.length > 0 ? { ok: false, leaked: [...new Set(leaked)] } : { ok: true };
}

export type ContinuityChecklistItem = {
  id: string;
  required: boolean;
  description: string;
};

export function buildContinuityChecklist(): ContinuityChecklistItem[] {
  return [
    {
      id: "postgres_source_of_truth",
      required: true,
      description: "Postgres remoto é a fonte da verdade; IndexedDB não substitui backup.",
    },
    {
      id: "idempotent_mutations",
      required: true,
      description: "Vendas/pagamentos/estoque/caixa usam client_mutation_id único por loja.",
    },
    {
      id: "rls_store_org",
      required: true,
      description: "RLS e membership isolam org/store; restore não pode bypassar via app role.",
    },
    {
      id: "outbox_retry_same_key",
      required: true,
      description: "Retry de outbox reutiliza a mesma chave; servidor deduplica.",
    },
    {
      id: "secrets_out_of_git",
      required: true,
      description: ".env real fora do git; secrets fora de NEXT_PUBLIC_*.",
    },
    {
      id: "operator_backup",
      required: true,
      description: "Backup/PITR é responsabilidade do operador/provedor, não da app.",
    },
    {
      id: "no_fake_backup_success",
      required: true,
      description: "Nunca reportar backup_success sem attestação/verificação real.",
    },
  ];
}

/**
 * B27 — Operational component health (honest, non-blocking).
 *
 * Complements liveness/readiness without inventing success for optional
 * integrations. Heavy DB scans are forbidden on the hot path: outbox/offline
 * counters come from in-process metrics only.
 */

import { checkReadiness, buildLiveness, type ReadinessStatus } from "@/lib/observability/health";
import { readMetricsSnapshot } from "@/lib/observability/metrics";
import {
  readOperatorBackupAttestationFromEnv,
  resolveBackupContinuityStatus,
} from "@/lib/domain/backup-continuity";
import { getPublicFiscalProviderStatus } from "@/lib/server/fiscal-provider";
import { getPublicPaymentProviderStatus } from "@/lib/server/payment-provider";
import { resolvePrinterConfigView } from "@/lib/adapters/printer";
import { validateProductionConfig } from "@/lib/production/config";

export const OPERATIONAL_COMPONENT_STATES = [
  "healthy",
  "degraded",
  "unhealthy",
  "unknown",
  "not_configured",
  "external_dependency",
] as const;

export type OperationalComponentState = (typeof OPERATIONAL_COMPONENT_STATES)[number];

export type OperationalComponentName =
  | "application"
  | "database"
  | "configuration"
  | "outbox"
  | "offline"
  | "fiscal"
  | "payments"
  | "cash"
  | "printer"
  | "backup";

export type OperationalComponent = {
  name: OperationalComponentName;
  state: OperationalComponentState;
  message: string;
  /** Optional non-sensitive counters (never PII). */
  details?: Record<string, number | string | boolean | null>;
};

export type OperationalAggregateStatus = "healthy" | "degraded" | "unhealthy";

export type OperationalHealthReport = {
  status: OperationalAggregateStatus;
  service: string;
  checked_at: string;
  liveness: "ok";
  readiness: ReadinessStatus["status"] | "unknown";
  components: OperationalComponent[];
  /** True when optional integrations are not_configured but core app is up. */
  optional_integrations_absent: boolean;
};

export type OutboxHealthSnapshot = {
  state: OperationalComponentState;
  pending: number | null;
  processing: number | null;
  failed: number | null;
  stuck: number | null;
  oldest_pending_age_sec: number | null;
  message: string;
};

const DEFAULT_DEPENDENCY_TIMEOUT_MS = 2_500;

/** Public `/api/health` rate limit (shared with route; not exported from route.ts). */
export const OPERATIONAL_HEALTH_RATE_LIMIT = 60;
export const OPERATIONAL_HEALTH_RATE_WINDOW_MS = 60_000;

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => T
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function metricSum(name: string, labelFilter?: Record<string, string>): number {
  let total = 0;
  for (const row of readMetricsSnapshot()) {
    if (row.name !== name) continue;
    if (labelFilter) {
      const ok = Object.entries(labelFilter).every(([k, v]) => row.labels[k] === v);
      if (!ok) continue;
    }
    total += row.value;
  }
  return total;
}

function metricGauge(name: string): number | null {
  const rows = readMetricsSnapshot().filter((row) => row.name === name);
  if (rows.length === 0) return null;
  // Latest write wins for gauges stored as absolute values via setMetricGauge.
  return rows[rows.length - 1]?.value ?? null;
}

/**
 * Read outbox health from in-process gauges only.
 *
 * All of pending/processing/failed/stuck must be present to classify healthy
 * or degraded. Partial gauges stay unknown — never invent zeros with `?? 0`.
 */
export function readOutboxHealthFromMetrics(): OutboxHealthSnapshot {
  const pending = metricGauge("outbox_pending");
  const processing = metricGauge("outbox_processing");
  const failed = metricGauge("outbox_failed");
  const stuck = metricGauge("outbox_stuck");
  const oldest = metricGauge("outbox_oldest_pending_age_sec");

  const required = [pending, processing, failed, stuck];
  const presentCount = required.filter((value) => value != null).length;

  if (presentCount === 0) {
    return {
      state: "unknown",
      pending: null,
      processing: null,
      failed: null,
      stuck: null,
      oldest_pending_age_sec: oldest,
      message: "Sem observação in-process de outbox neste runtime (não inventado).",
    };
  }

  if (presentCount < 4) {
    return {
      state: "unknown",
      pending,
      processing,
      failed,
      stuck,
      oldest_pending_age_sec: oldest,
      message:
        "Observação parcial de outbox; métricas ausentes não são tratadas como zero.",
    };
  }

  // All four required gauges are present (TypeScript: narrow via presentCount).
  const failedCount = failed as number;
  const stuckCount = stuck as number;

  if (failedCount > 0 || stuckCount > 0) {
    return {
      state: "degraded",
      pending,
      processing,
      failed,
      stuck,
      oldest_pending_age_sec: oldest,
      message: "Outbox com falhas ou itens stuck observados neste processo.",
    };
  }

  return {
    state: "healthy",
    pending,
    processing,
    failed,
    stuck,
    oldest_pending_age_sec: oldest,
    message: "Outbox observado sem falhas/stuck neste processo.",
  };
}

export function readOfflineHealthFromMetrics(): OperationalComponent {
  const pending = metricGauge("offline_pending_ops");
  const conflicts = metricGauge("offline_conflicts");
  const lastSyncAge = metricGauge("offline_last_sync_age_sec");

  if (pending == null && conflicts == null && lastSyncAge == null) {
    return {
      name: "offline",
      state: "unknown",
      message:
        "Fila offline é por terminal (IndexedDB); servidor não inventa contagem global.",
      details: {
        source_of_truth: "postgres",
        local_role: "terminal_cache_outbox",
      },
    };
  }

  if ((conflicts ?? 0) > 0 || (pending ?? 0) > 100) {
    return {
      name: "offline",
      state: "degraded",
      message: "Sync/offline degradado neste processo (conflitos ou fila alta).",
      details: {
        pending_ops: pending,
        conflicts,
        last_sync_age_sec: lastSyncAge,
      },
    };
  }

  return {
    name: "offline",
    state: "healthy",
    message: "Observação offline local sem sinais críticos neste processo.",
    details: {
      pending_ops: pending,
      conflicts,
      last_sync_age_sec: lastSyncAge,
    },
  };
}

function mapFiscalComponent(): OperationalComponent {
  const status = getPublicFiscalProviderStatus();
  if (status.status === "not_configured") {
    return {
      name: "fiscal",
      state: "not_configured",
      message: status.message,
      details: {
        provider: status.provider,
        nfce: status.methods.nfce,
        sat: status.methods.sat,
      },
    };
  }
  // Env present ≠ live SEFAZ authorization. Report external_dependency, never "authorized".
  return {
    name: "fiscal",
    state: "external_dependency",
    message: "Provider fiscal configurado no env; autorização SEFAZ/SAT é dependência externa.",
    details: {
      provider: status.provider,
      nfce: status.methods.nfce,
      sat: status.methods.sat,
    },
  };
}

function mapPaymentsComponent(): OperationalComponent {
  const status = getPublicPaymentProviderStatus();
  if (status.status === "not_configured") {
    return {
      name: "payments",
      state: "not_configured",
      message: status.message,
      details: {
        provider: status.provider,
        pix: status.methods.pix,
        card: status.methods.card,
        tef: status.methods.tef,
      },
    };
  }
  return {
    name: "payments",
    state: "external_dependency",
    message: "Provider de pagamento configurado no env; captura real é dependência externa.",
    details: {
      provider: status.provider,
      pix: status.methods.pix,
      card: status.methods.card,
      tef: status.methods.tef,
    },
  };
}

function mapCashComponent(): OperationalComponent {
  // Cash is always available as a local method; never claim electronic capture.
  return {
    name: "cash",
    state: "healthy",
    message: "Pagamento em dinheiro disponível localmente (não é captura eletrônica).",
  };
}

function mapPrinterComponent(): OperationalComponent {
  const view = resolvePrinterConfigView({ mode: "browser" });
  if (!view.printerConfigured) {
    return {
      name: "printer",
      state: "not_configured",
      message: view.message,
      details: { mode: view.mode, available_modes: view.availableModes.join(",") },
    };
  }
  return {
    name: "printer",
    state: "healthy",
    message: "Impressão pelo navegador disponível; hardware ESC/POS/rede permanece not_configured sem bridge.",
    details: {
      mode: "browser",
      hardware_bridge: "not_configured",
    },
  };
}

function mapBackupComponent(): OperationalComponent {
  const continuity = resolveBackupContinuityStatus(readOperatorBackupAttestationFromEnv());
  if (continuity.backup_status === "verified" && continuity.recovery_ready) {
    return {
      name: "backup",
      state: "external_dependency",
      message: "Operador atestou drill de backup; app não executa PITR.",
      details: {
        backup_status: continuity.backup_status,
        backup_available: continuity.backup_available,
        recovery_ready: continuity.recovery_ready,
        backup_last_verified: continuity.backup_last_verified,
      },
    };
  }
  if (continuity.backup_status === "failed") {
    return {
      name: "backup",
      state: "unhealthy",
      message: "Operador atestou falha de backup/restore.",
      details: {
        backup_status: continuity.backup_status,
        recovery_ready: false,
      },
    };
  }
  return {
    name: "backup",
    state: "external_dependency",
    message: "Backup/PITR é responsabilidade do operador/provedor; recovery_ready=false sem drill.",
    details: {
      backup_status: continuity.backup_status,
      backup_available: continuity.backup_available,
      recovery_ready: continuity.recovery_ready,
      backup_last_verified: continuity.backup_last_verified,
    },
  };
}

function mapConfigurationComponent(): OperationalComponent {
  if (process.env.NODE_ENV !== "production") {
    return {
      name: "configuration",
      state: "healthy",
      message: "Gate de produção skipped fora de NODE_ENV=production.",
      details: { production_config: "skipped" },
    };
  }
  const gate = validateProductionConfig();
  if (!gate.ok) {
    return {
      name: "configuration",
      state: "unhealthy",
      message: "Configuração de produção inválida.",
      details: { production_config: "invalid", fatal_count: gate.fatal.length },
    };
  }
  return {
    name: "configuration",
    state: "healthy",
    message: "Configuração de produção ok.",
    details: { production_config: "ok" },
  };
}

/** Core dependencies required for essential readiness. */
export const CORE_OPERATIONAL_COMPONENTS: OperationalComponentName[] = [
  "application",
  "database",
  "configuration",
];

/** Optional integrations — not_configured must not take the app down. */
export const OPTIONAL_OPERATIONAL_COMPONENTS: OperationalComponentName[] = [
  "fiscal",
  "payments",
  "printer",
  "backup",
];

function isCoreComponent(name: OperationalComponentName): boolean {
  return CORE_OPERATIONAL_COMPONENTS.includes(name);
}

/**
 * Aggregate hierarchy:
 * - Core unhealthy / database unavailable → unhealthy
 * - readiness not_ready OR core not_configured/unknown/degraded → degraded
 * - Optional not_configured/external_dependency never force unhealthy alone
 * - Optional/outbox/offline degraded → degraded
 */
export function aggregateStatus(
  components: OperationalComponent[],
  readiness: ReadinessStatus["status"] | "unknown"
): OperationalAggregateStatus {
  const byName = Object.fromEntries(components.map((c) => [c.name, c])) as Partial<
    Record<OperationalComponentName, OperationalComponent>
  >;

  const database = byName.database;
  if (database?.state === "unhealthy") return "unhealthy";
  if (byName.configuration?.state === "unhealthy") return "unhealthy";
  if (byName.application?.state === "unhealthy") return "unhealthy";

  // Essential dependency missing or not ready cannot be top-level healthy.
  if (readiness === "not_ready" || readiness === "unknown") return "degraded";
  if (
    database?.state === "not_configured" ||
    database?.state === "unknown" ||
    database?.state === "degraded"
  ) {
    return "degraded";
  }
  if (byName.configuration?.state === "degraded") return "degraded";
  if (byName.application?.state === "degraded") return "degraded";

  // Non-core signals (outbox/offline/cash) may degrade without 503 for optionals alone.
  for (const component of components) {
    if (isCoreComponent(component.name)) continue;
    if (OPTIONAL_OPERATIONAL_COMPONENTS.includes(component.name)) {
      if (component.state === "unhealthy") return "degraded";
      if (component.state === "degraded") return "degraded";
      continue;
    }
    if (component.state === "degraded" || component.state === "unhealthy") return "degraded";
  }

  return "healthy";
}

export type BuildOperationalHealthOptions = {
  readiness?: ReadinessStatus;
  dependencyTimeoutMs?: number;
  nowIso?: string;
};

/**
 * Build a deterministic operational report.
 * Optional integrations as not_configured never flip liveness semantics.
 */
export async function buildOperationalHealthReport(
  options: BuildOperationalHealthOptions = {}
): Promise<OperationalHealthReport> {
  const checkedAt = options.nowIso ?? new Date().toISOString();
  const liveness = buildLiveness();
  const timeoutMs = options.dependencyTimeoutMs ?? DEFAULT_DEPENDENCY_TIMEOUT_MS;

  const readiness =
    options.readiness ??
    (await withTimeout(checkReadiness(), timeoutMs, () => ({
      status: "not_ready" as const,
      service: "nexgestaovendas",
      checked_at: checkedAt,
      checks: {
        auth_configured: Boolean(
          process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
        ),
        production_config:
          process.env.NODE_ENV === "production" ? ("invalid" as const) : ("skipped" as const),
        database: "unavailable" as const,
      },
    })));

  const databaseState: OperationalComponentState =
    readiness.checks.database === "ok"
      ? "healthy"
      : readiness.checks.database === "not_configured"
        ? "not_configured"
        : "unhealthy";

  const outbox = readOutboxHealthFromMetrics();
  const components: OperationalComponent[] = [
    {
      name: "application",
      state: "healthy",
      message: "Processo vivo (liveness ok).",
      details: { liveness: liveness.status },
    },
    {
      name: "database",
      state: databaseState,
      message:
        databaseState === "healthy"
          ? "Probe leve de stores ok."
          : databaseState === "not_configured"
            ? "Auth/DB não configurados neste runtime."
            : "Banco indisponível ou timeout no probe.",
      details: {
        readiness: readiness.status,
        database: readiness.checks.database,
      },
    },
    mapConfigurationComponent(),
    {
      name: "outbox",
      state: outbox.state,
      message: outbox.message,
      details: {
        pending: outbox.pending,
        processing: outbox.processing,
        failed: outbox.failed,
        stuck: outbox.stuck,
        oldest_pending_age_sec: outbox.oldest_pending_age_sec,
      },
    },
    readOfflineHealthFromMetrics(),
    mapFiscalComponent(),
    mapPaymentsComponent(),
    mapCashComponent(),
    mapPrinterComponent(),
    mapBackupComponent(),
  ];

  const optionalAbsent = components.some(
    (c) =>
      (c.name === "fiscal" || c.name === "payments" || c.name === "printer") &&
      c.state === "not_configured"
  );

  // API error pressure (in-process) can degrade without killing liveness.
  const apiErrors = metricSum("api_requests", { outcome: "error" });
  if (apiErrors > 0) {
    const app = components.find((c) => c.name === "application");
    if (app && apiErrors >= 10) {
      app.state = "degraded";
      app.message = "Processo vivo com volume elevado de erros de API neste processo.";
      app.details = { ...(app.details ?? {}), api_errors: apiErrors };
    }
  }

  return {
    status: aggregateStatus(components, readiness.status),
    service: "nexgestaovendas",
    checked_at: checkedAt,
    liveness: "ok",
    readiness: readiness.status,
    components,
    optional_integrations_absent: optionalAbsent,
  };
}

/**
 * HTTP mapping:
 * - unhealthy → 503
 * - readiness not_ready (essential unavailable) → 503
 * - degraded only from optional/outbox while ready → 200
 * - healthy → 200
 */
export function operationalHttpStatus(report: OperationalHealthReport): number {
  if (report.status === "unhealthy") return 503;
  if (report.readiness === "not_ready" || report.readiness === "unknown") return 503;
  return 200;
}

/** Strip any accidental sensitive keys before JSON serialization. */
export function publicOperationalHealthPayload(report: OperationalHealthReport): OperationalHealthReport {
  const forbidden = /(secret|token|password|api[_-]?key|authorization|service[_-]?role|cpf|document)/i;
  const components = report.components.map((component) => {
    if (!component.details) return component;
    const details: Record<string, number | string | boolean | null> = {};
    for (const [key, value] of Object.entries(component.details)) {
      if (forbidden.test(key)) continue;
      if (typeof value === "string" && forbidden.test(value) && value.length > 12) continue;
      details[key] = value;
    }
    return { ...component, details };
  });
  return { ...report, components };
}

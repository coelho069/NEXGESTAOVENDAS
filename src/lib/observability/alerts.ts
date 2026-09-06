/**
 * B27 — Alert evaluation contracts.
 *
 * Evaluates which alerts WOULD fire from an operational snapshot.
 * External delivery (Slack/email/webhook) stays not_configured unless a real
 * notifier is wired — never pretends a notification was sent.
 */

import type { OperationalHealthReport } from "@/lib/observability/operational-status";

export const ALERT_CODES = [
  "outbox_stuck",
  "outbox_failed",
  "database_unhealthy",
  "sync_degraded",
  "fiscal_failure",
  "payment_failure",
  "printer_failure",
  "backup_unverified",
  "configuration_unhealthy",
  "application_degraded",
] as const;

export type AlertCode = (typeof ALERT_CODES)[number];

export type AlertSeverity = "info" | "warning" | "critical";

export type EvaluatedAlert = {
  code: AlertCode;
  severity: AlertSeverity;
  message: string;
};

export type AlertNotifierStatus = {
  status: "not_configured" | "configured";
  provider: string;
  message: string;
};

export type AlertDispatchResult = {
  status: "not_configured" | "dispatched" | "failed";
  provider: string;
  message: string;
  alert_count: number;
};

/**
 * Public notifier readiness. Env alone is not enough for "configured" unless
 * a concrete provider + URL are present AND a real sender exists.
 * Today no external sender is wired ⇒ always not_configured.
 */
export function getAlertNotifierStatus(
  env: NodeJS.Dict<string | undefined> = process.env
): AlertNotifierStatus {
  const provider = (env.ALERT_PROVIDER ?? "").trim();
  const webhook = (env.ALERT_WEBHOOK_URL ?? "").trim();
  if (!provider || !webhook) {
    return {
      status: "not_configured",
      provider: "not_configured",
      message: "Nenhum canal de alerta externo configurado (Slack/email/webhook).",
    };
  }
  // Provider env present but no real dispatcher implemented yet.
  return {
    status: "not_configured",
    provider: "not_configured",
    message: `ALERT_PROVIDER=${provider} definido, mas dispatcher externo ainda não implementado; nenhum envio será fingido.`,
  };
}

export function evaluateOperationalAlerts(report: OperationalHealthReport): EvaluatedAlert[] {
  const alerts: EvaluatedAlert[] = [];
  const byName = Object.fromEntries(report.components.map((c) => [c.name, c]));

  const database = byName.database;
  if (database?.state === "unhealthy") {
    alerts.push({
      code: "database_unhealthy",
      severity: "critical",
      message: database.message,
    });
  }

  const outbox = byName.outbox;
  if (outbox) {
    const failed = typeof outbox.details?.failed === "number" ? outbox.details.failed : 0;
    const stuck = typeof outbox.details?.stuck === "number" ? outbox.details.stuck : 0;
    if (stuck > 0) {
      alerts.push({
        code: "outbox_stuck",
        severity: "warning",
        message: `Outbox stuck_count=${stuck}`,
      });
    }
    if (failed > 0) {
      alerts.push({
        code: "outbox_failed",
        severity: "warning",
        message: `Outbox failed_count=${failed}`,
      });
    }
  }

  const offline = byName.offline;
  if (offline?.state === "degraded") {
    alerts.push({
      code: "sync_degraded",
      severity: "warning",
      message: offline.message,
    });
  }

  const fiscal = byName.fiscal;
  if (fiscal?.state === "unhealthy" || fiscal?.state === "degraded") {
    alerts.push({
      code: "fiscal_failure",
      severity: "warning",
      message: fiscal.message,
    });
  }

  const payments = byName.payments;
  if (payments?.state === "unhealthy" || payments?.state === "degraded") {
    alerts.push({
      code: "payment_failure",
      severity: "warning",
      message: payments.message,
    });
  }

  const printer = byName.printer;
  if (printer?.state === "unhealthy" || printer?.state === "degraded") {
    alerts.push({
      code: "printer_failure",
      severity: "info",
      message: printer.message,
    });
  }

  const backup = byName.backup;
  if (
    backup &&
    backup.details?.recovery_ready === false &&
    backup.details?.backup_status !== "verified"
  ) {
    alerts.push({
      code: "backup_unverified",
      severity: "info",
      message: "Backup/recovery sem drill atestado (recovery_ready=false).",
    });
  }
  if (backup?.state === "unhealthy") {
    alerts.push({
      code: "backup_unverified",
      severity: "critical",
      message: backup.message,
    });
  }

  const configuration = byName.configuration;
  if (configuration?.state === "unhealthy") {
    alerts.push({
      code: "configuration_unhealthy",
      severity: "critical",
      message: configuration.message,
    });
  }

  const application = byName.application;
  if (application?.state === "degraded") {
    alerts.push({
      code: "application_degraded",
      severity: "warning",
      message: application.message,
    });
  }

  return alerts;
}

/**
 * Never pretends external delivery succeeded. Returns not_configured until a
 * real notifier adapter exists.
 */
export function dispatchOperationalAlerts(
  alerts: EvaluatedAlert[],
  env: NodeJS.Dict<string | undefined> = process.env
): AlertDispatchResult {
  const notifier = getAlertNotifierStatus(env);
  return {
    status: "not_configured",
    provider: notifier.provider,
    message: notifier.message,
    alert_count: alerts.length,
  };
}

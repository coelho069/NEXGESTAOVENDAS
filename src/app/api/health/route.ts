import { NextResponse } from "next/server";
import { readCorrelationId, applyCorrelationHeaders } from "@/lib/observability/correlation";
import { rootLogger } from "@/lib/observability/logger";
import { incrementMetric } from "@/lib/observability/metrics";
import {
  OPERATIONAL_HEALTH_RATE_LIMIT,
  OPERATIONAL_HEALTH_RATE_WINDOW_MS,
  buildOperationalHealthReport,
  operationalHttpStatus,
  publicOperationalHealthPayload,
} from "@/lib/observability/operational-status";
import {
  dispatchOperationalAlerts,
  evaluateOperationalAlerts,
  getAlertNotifierStatus,
} from "@/lib/observability/alerts";
import { isSensitiveOperationalLeak } from "@/lib/observability/events";
import { clientRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * B27 operational health snapshot.
 * Public, no secrets/PII. Optional integrations as not_configured do not
 * imply liveness failure. HTTP 503 when unhealthy or readiness not_ready.
 *
 * Rate-limit key uses clientRateLimitKey: X-Forwarded-For is only trusted when
 * TRUST_PROXY=1 (edge sanitizes client IP). Otherwise a single coarse bucket
 * prevents unlimited spoofing via arbitrary forwarded headers.
 */
export async function GET(request: Request) {
  const correlationId = readCorrelationId(request.headers);
  const logger = rootLogger.child({ correlationId, route: "api.health" });

  const limited = consumeRateLimit({
    key: clientRateLimitKey(request, "api.health"),
    limit: OPERATIONAL_HEALTH_RATE_LIMIT,
    windowMs: OPERATIONAL_HEALTH_RATE_WINDOW_MS,
  });
  if (!limited.allowed) {
    const response = NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(limited.retryAfterSec),
        },
      }
    );
    applyCorrelationHeaders(response.headers, correlationId);
    return response;
  }

  const report = publicOperationalHealthPayload(await buildOperationalHealthReport());
  const alerts = evaluateOperationalAlerts(report);
  const notifier = getAlertNotifierStatus();
  const dispatch = dispatchOperationalAlerts(alerts);

  const body = {
    ...report,
    alerts: {
      evaluated: alerts.map((alert) => ({
        code: alert.code,
        severity: alert.severity,
        message: alert.message,
      })),
      notifier,
      dispatch: {
        status: dispatch.status,
        provider: dispatch.provider,
        message: dispatch.message,
        alert_count: dispatch.alert_count,
      },
    },
  };

  if (isSensitiveOperationalLeak(body)) {
    logger.error("health_payload_secret_leak_blocked");
    const response = NextResponse.json(
      { error: "health_payload_rejected" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
    applyCorrelationHeaders(response.headers, correlationId);
    return response;
  }

  const status = operationalHttpStatus(report);
  incrementMetric("health_operational_checks", { status: report.status });
  if (report.status !== "healthy") {
    logger.warn("operational_health_not_healthy", {
      status: report.status,
      readiness: report.readiness,
      alert_count: alerts.length,
    });
  }

  const response = NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
  applyCorrelationHeaders(response.headers, correlationId);
  return response;
}

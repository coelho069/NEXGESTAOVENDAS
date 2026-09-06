import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPERATIONAL_HEALTH_RATE_LIMIT,
  aggregateStatus,
  buildOperationalHealthReport,
  operationalHttpStatus,
  publicOperationalHealthPayload,
  readOutboxHealthFromMetrics,
  withTimeout,
} from "@/lib/observability/operational-status";
import {
  dispatchOperationalAlerts,
  evaluateOperationalAlerts,
  getAlertNotifierStatus,
} from "@/lib/observability/alerts";
import {
  buildOperationalEvent,
  isSensitiveOperationalLeak,
  sanitizeOperationalFields,
} from "@/lib/observability/events";
import {
  observeOfflineHealth,
  observeOutboxHealth,
  resetMetricsForTests,
  setMetricGauge,
} from "@/lib/observability/metrics";
import { resetRateLimitStateForTests } from "@/lib/security/rate-limit";

const { getAuthedContext, createClient, createAdminClient, checkReadiness } = vi.hoisted(() => ({
  getAuthedContext: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(() => null),
  checkReadiness: vi.fn(async () => ({
    status: "not_ready" as const,
    service: "nexgestaovendas",
    checked_at: "2026-09-06T15:00:00.000Z",
    checks: {
      auth_configured: false,
      production_config: "skipped" as const,
      database: "not_configured" as const,
    },
  })),
}));

vi.mock("@/lib/auth/session", () => ({ getAuthedContext }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/observability/health", async () => {
  const actual = await vi.importActual<typeof import("@/lib/observability/health")>(
    "@/lib/observability/health"
  );
  return {
    ...actual,
    checkReadiness,
  };
});

import { buildLiveness } from "@/lib/observability/health";
import { GET as healthGet } from "@/app/api/health/route";

describe("B27 operational health states", () => {
  beforeEach(() => {
    resetMetricsForTests();
    resetRateLimitStateForTests();
  });

  afterEach(() => {
    resetMetricsForTests();
    resetRateLimitStateForTests();
  });

  it("keeps liveness ok independent of optional integrations", () => {
    const live = buildLiveness();
    expect(live.status).toBe("ok");
  });

  it("optional not_configured does not 503 when core is ready", async () => {
    const report = await buildOperationalHealthReport({
      readiness: {
        status: "ready",
        service: "nexgestaovendas",
        checked_at: "2026-09-06T15:00:00.000Z",
        checks: {
          auth_configured: true,
          production_config: "skipped",
          database: "ok",
        },
      },
      nowIso: "2026-09-06T15:00:00.000Z",
    });

    const byName = Object.fromEntries(report.components.map((c) => [c.name, c]));
    expect(byName.application?.state).toBe("healthy");
    expect(byName.database?.state).toBe("healthy");
    expect(byName.fiscal?.state).toBe("not_configured");
    expect(byName.payments?.state).toBe("not_configured");
    expect(byName.backup?.state).toBe("external_dependency");
    expect(byName.backup?.details?.recovery_ready).toBe(false);
    expect(report.liveness).toBe("ok");
    expect(report.readiness).toBe("ready");
    expect(report.status).toBe("healthy");
    expect(operationalHttpStatus(report)).toBe(200);
    expect(JSON.stringify(report)).not.toMatch(/authorized|print_succeeded|captured|paid/i);
  });

  it("database not_configured + readiness not_ready is not top-level healthy / not HTTP 200", async () => {
    const report = await buildOperationalHealthReport({
      readiness: {
        status: "not_ready",
        service: "nexgestaovendas",
        checked_at: "2026-09-06T15:00:00.000Z",
        checks: {
          auth_configured: false,
          production_config: "skipped",
          database: "not_configured",
        },
      },
      nowIso: "2026-09-06T15:00:00.000Z",
    });

    expect(report.components.find((c) => c.name === "database")?.state).toBe("not_configured");
    expect(report.readiness).toBe("not_ready");
    expect(report.status).not.toBe("healthy");
    expect(report.status).toBe("degraded");
    expect(operationalHttpStatus(report)).toBe(503);
    expect(report.liveness).toBe("ok");
    expect(report.components.find((c) => c.name === "fiscal")?.state).toBe("not_configured");
  });

  it("marks aggregate unhealthy when database probe fails", async () => {
    const report = await buildOperationalHealthReport({
      readiness: {
        status: "not_ready",
        service: "nexgestaovendas",
        checked_at: "2026-09-06T15:00:00.000Z",
        checks: {
          auth_configured: true,
          production_config: "ok",
          database: "unavailable",
        },
      },
    });
    expect(report.components.find((c) => c.name === "database")?.state).toBe("unhealthy");
    expect(report.status).toBe("unhealthy");
    expect(operationalHttpStatus(report)).toBe(503);
  });

  it("aggregateStatus hierarchy separates core vs optional", () => {
    const base = [
      { name: "application" as const, state: "healthy" as const, message: "ok" },
      { name: "database" as const, state: "healthy" as const, message: "ok" },
      { name: "configuration" as const, state: "healthy" as const, message: "ok" },
      { name: "fiscal" as const, state: "not_configured" as const, message: "n/c" },
      { name: "payments" as const, state: "not_configured" as const, message: "n/c" },
      { name: "printer" as const, state: "healthy" as const, message: "browser" },
      { name: "backup" as const, state: "external_dependency" as const, message: "ext" },
    ];
    expect(aggregateStatus(base, "ready")).toBe("healthy");
    expect(aggregateStatus(base, "not_ready")).toBe("degraded");
    expect(
      aggregateStatus(
        base.map((c) =>
          c.name === "database" ? { ...c, state: "not_configured" as const } : c
        ),
        "not_ready"
      )
    ).toBe("degraded");
    expect(
      aggregateStatus(
        base.map((c) => (c.name === "database" ? { ...c, state: "unhealthy" as const } : c)),
        "not_ready"
      )
    ).toBe("unhealthy");
  });

  it("times out slow dependency probes", async () => {
    const result = await withTimeout(
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("late"), 50);
      }),
      5,
      () => "timeout"
    );
    expect(result).toBe("timeout");
  });
});

describe("B27.3 outbox partial gauges", () => {
  beforeEach(() => resetMetricsForTests());
  afterEach(() => resetMetricsForTests());

  it("nenhum gauge → unknown", () => {
    const health = readOutboxHealthFromMetrics();
    expect(health.state).toBe("unknown");
    expect(health.pending).toBeNull();
    expect(health.processing).toBeNull();
    expect(health.failed).toBeNull();
    expect(health.stuck).toBeNull();
  });

  it("somente pending → unknown (não inventa zeros)", () => {
    setMetricGauge("outbox_pending", 0);
    const health = readOutboxHealthFromMetrics();
    expect(health.state).toBe("unknown");
    expect(health.pending).toBe(0);
    expect(health.processing).toBeNull();
    expect(health.failed).toBeNull();
    expect(health.stuck).toBeNull();
  });

  it("somente failed → unknown even when failed=0", () => {
    setMetricGauge("outbox_failed", 0);
    const health = readOutboxHealthFromMetrics();
    expect(health.state).toBe("unknown");
    expect(health.failed).toBe(0);
    expect(health.pending).toBeNull();
  });

  it("somente processing → unknown", () => {
    setMetricGauge("outbox_processing", 1);
    expect(readOutboxHealthFromMetrics().state).toBe("unknown");
  });

  it("somente stuck → unknown", () => {
    setMetricGauge("outbox_stuck", 0);
    expect(readOutboxHealthFromMetrics().state).toBe("unknown");
  });

  it("combinações parciais → unknown", () => {
    observeOutboxHealth({ pending: 1, failed: 0 });
    const health = readOutboxHealthFromMetrics();
    expect(health.state).toBe("unknown");
    expect(health.pending).toBe(1);
    expect(health.failed).toBe(0);
    expect(health.processing).toBeNull();
    expect(health.stuck).toBeNull();
  });

  it("todos disponíveis + saudáveis → healthy", () => {
    observeOutboxHealth({
      pending: 0,
      processing: 0,
      failed: 0,
      stuck: 0,
      oldestPendingAgeSec: 0,
    });
    const health = readOutboxHealthFromMetrics();
    expect(health.state).toBe("healthy");
    expect(health.pending).toBe(0);
    expect(health.processing).toBe(0);
    expect(health.failed).toBe(0);
    expect(health.stuck).toBe(0);
  });

  it("todos disponíveis + failed/stuck → degraded", () => {
    observeOutboxHealth({
      pending: 3,
      processing: 1,
      failed: 2,
      stuck: 1,
      oldestPendingAgeSec: 120,
    });
    const health = readOutboxHealthFromMetrics();
    expect(health.state).toBe("degraded");
    expect(health.failed).toBe(2);
    expect(health.stuck).toBe(1);
  });
});

describe("B27 outbox / offline observation", () => {
  beforeEach(() => resetMetricsForTests());
  afterEach(() => resetMetricsForTests());

  it("observing offline conflicts marks sync degraded in report", async () => {
    observeOfflineHealth({ pendingOps: 5, conflicts: 2, lastSyncAgeSec: 30 });
    const report = await buildOperationalHealthReport({
      readiness: {
        status: "ready",
        service: "nexgestaovendas",
        checked_at: "2026-09-06T15:00:00.000Z",
        checks: {
          auth_configured: true,
          production_config: "skipped",
          database: "ok",
        },
      },
    });
    expect(report.components.find((c) => c.name === "offline")?.state).toBe("degraded");
    expect(report.status).toBe("degraded");
    expect(operationalHttpStatus(report)).toBe(200);
  });
});

describe("B27 alerts and events", () => {
  beforeEach(() => resetMetricsForTests());

  it("evaluates alerts without claiming external dispatch", async () => {
    observeOutboxHealth({ failed: 1, stuck: 2, pending: 1, processing: 0 });
    const report = await buildOperationalHealthReport({
      readiness: {
        status: "not_ready",
        service: "nexgestaovendas",
        checked_at: "2026-09-06T15:00:00.000Z",
        checks: {
          auth_configured: true,
          production_config: "ok",
          database: "unavailable",
        },
      },
    });
    const alerts = evaluateOperationalAlerts(report);
    expect(alerts.some((a) => a.code === "database_unhealthy")).toBe(true);
    expect(alerts.some((a) => a.code === "outbox_stuck")).toBe(true);
    expect(alerts.some((a) => a.code === "outbox_failed")).toBe(true);
    expect(alerts.some((a) => a.code === "backup_unverified")).toBe(true);

    expect(getAlertNotifierStatus({}).status).toBe("not_configured");
    const dispatch = dispatchOperationalAlerts(alerts, {
      ALERT_PROVIDER: "slack",
      ALERT_WEBHOOK_URL: "https://hooks.example/test",
    });
    expect(dispatch.status).toBe("not_configured");
    expect(dispatch.status).not.toBe("dispatched");
  });

  it("redacts documents/secrets from operational events", () => {
    const event = buildOperationalEvent({
      kind: "payment",
      message: "payment_attempt",
      correlation_id: "c1",
      store_id: "s1",
      fields: {
        password: "secret",
        api_key: "k",
        cpf: "390.533.447-05",
        note: "cliente 390.533.447-05",
        client_mutation_id: "m1",
      },
    });
    expect(event.fields).not.toHaveProperty("password");
    expect(event.fields).not.toHaveProperty("api_key");
    expect(event.fields).not.toHaveProperty("cpf");
    expect(event.fields?.note).toBe("[redacted_document]");
    expect(event.fields?.client_mutation_id).toBe("m1");

    const sanitized = sanitizeOperationalFields({
      document: "123",
      store_id: "s1",
    });
    expect(sanitized).not.toHaveProperty("document");
    expect(sanitized?.store_id).toBe("s1");
    expect(isSensitiveOperationalLeak({ api_key: "x" })).toBe(true);
    expect(isSensitiveOperationalLeak({ status: "ok" })).toBe(false);
  });
});

describe("B27 /api/health endpoint", () => {
  beforeEach(() => {
    resetMetricsForTests();
    resetRateLimitStateForTests();
    delete process.env.TRUST_PROXY;
  });

  afterEach(() => {
    resetRateLimitStateForTests();
    delete process.env.TRUST_PROXY;
  });

  it("returns public operational payload without secrets and coherent HTTP status", async () => {
    const response = await healthGet(
      new Request("http://localhost/api/health", {
        headers: { "x-correlation-id": "b27-health-001" },
      })
    );
    expect([200, 503]).toContain(response.status);
    expect(response.headers.get("x-correlation-id")).toBe("b27-health-001");
    const body = (await response.json()) as {
      status: string;
      liveness: string;
      readiness: string;
      components: Array<{ name: string; state: string }>;
      alerts: { notifier: { status: string }; dispatch: { status: string } };
    };
    expect(body.liveness).toBe("ok");
    expect(body.components.some((c) => c.name === "fiscal" && c.state === "not_configured")).toBe(
      true
    );
    expect(body.components.some((c) => c.name === "payments" && c.state === "not_configured")).toBe(
      true
    );
    expect(body.components.some((c) => c.name === "backup")).toBe(true);
    expect(body.alerts.notifier.status).toBe("not_configured");
    expect(body.alerts.dispatch.status).toBe("not_configured");
    if (body.readiness === "not_ready") {
      expect(body.status).not.toBe("healthy");
      expect(response.status).toBe(503);
    }
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/SERVICE_ROLE|password|api_key|eyJ/i);
    expect(raw).not.toMatch(/\bauthorized\b|\bcaptured\b|\bprint_succeeded\b/i);
    expect(raw).not.toMatch(/ALERT_WEBHOOK_URL|hooks\.example/i);
  });

  it("strips forbidden detail keys from public payload", () => {
    const cleaned = publicOperationalHealthPayload({
      status: "healthy",
      service: "nexgestaovendas",
      checked_at: "2026-09-06T15:00:00.000Z",
      liveness: "ok",
      readiness: "ready",
      optional_integrations_absent: true,
      components: [
        {
          name: "application",
          state: "healthy",
          message: "ok",
          details: {
            api_key: "should-go",
            liveness: "ok",
          },
        },
      ],
    });
    expect(cleaned.components[0]?.details).not.toHaveProperty("api_key");
    expect(cleaned.components[0]?.details?.liveness).toBe("ok");
  });
});

describe("B27.3 rate limit / X-Forwarded-For", () => {
  beforeEach(() => {
    resetRateLimitStateForTests();
    resetMetricsForTests();
    delete process.env.TRUST_PROXY;
  });

  afterEach(() => {
    resetRateLimitStateForTests();
    delete process.env.TRUST_PROXY;
  });

  it("70 requests from same origin hit 429 after the limit", async () => {
    let limited = 0;
    for (let i = 0; i < OPERATIONAL_HEALTH_RATE_LIMIT + 10; i += 1) {
      const response = await healthGet(
        new Request("http://localhost/api/health", {
          headers: { "x-correlation-id": `b27-rl-same-${i}` },
        })
      );
      if (response.status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
    expect(limited).toBe(10);
  });

  it("alternating X-Forwarded-For without TRUST_PROXY cannot create unlimited buckets", async () => {
    let limited = 0;
    let allowed = 0;
    for (let i = 0; i < OPERATIONAL_HEALTH_RATE_LIMIT + 10; i += 1) {
      const response = await healthGet(
        new Request("http://localhost/api/health", {
          headers: {
            "x-correlation-id": `b27-rl-xff-${i}`,
            "x-forwarded-for": `203.0.113.${i % 250}`,
          },
        })
      );
      if (response.status === 429) limited += 1;
      else allowed += 1;
    }
    // Without TRUST_PROXY all requests share api.health:untrusted.
    expect(allowed).toBe(OPERATIONAL_HEALTH_RATE_LIMIT);
    expect(limited).toBe(10);
  });
});

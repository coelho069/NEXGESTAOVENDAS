import { describe, expect, it, beforeEach } from "vitest";
import {
  normalizeCorrelationId,
  readCorrelationId,
  CORRELATION_HEADER,
} from "@/lib/observability/correlation";
import { createLogger } from "@/lib/observability/logger";
import {
  incrementMetric,
  readMetricsSnapshot,
  resetMetricsForTests,
} from "@/lib/observability/metrics";
import { buildLiveness, checkReadiness } from "@/lib/observability/health";
import {
  assertSingleFinancialEffect,
  canSafelyRetryOutbox,
  describeBackupRecoveryLimitations,
} from "@/lib/observability/recovery";
import {
  backoffDelayMs,
  shouldMarkOutboxFailed,
  MAX_TRANSIENT_FAILURES,
} from "@/lib/offline/backoff";

describe("observability", () => {
  beforeEach(() => {
    resetMetricsForTests();
  });

  it("normalizes or mints correlation ids", () => {
    expect(normalizeCorrelationId("11111111-1111-4111-8111-111111111111")).toBe(
      "11111111-1111-4111-8111-111111111111"
    );
    expect(normalizeCorrelationId("bad\nid")).not.toContain("\n");
    expect(normalizeCorrelationId(null)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    const headers = new Headers({ [CORRELATION_HEADER]: "corr-abc-12345" });
    expect(readCorrelationId(headers)).toBe("corr-abc-12345");
  });

  it("emits structured logs without secrets", () => {
    const lines: string[] = [];
    const original = console.info;
    console.info = ((message?: unknown) => {
      lines.push(String(message));
    }) as typeof console.info;

    createLogger({ correlationId: "c1" }).info("sale_ok", {
      password: "secret",
      api_key: "k",
      client_mutation_id: "m1",
      storeId: "s1",
    });
    console.info = original;

    expect(lines).toHaveLength(1);
    const payload = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(payload.msg).toBe("sale_ok");
    expect(payload.correlationId).toBe("c1");
    expect(payload).not.toHaveProperty("password");
    expect(payload).not.toHaveProperty("api_key");
    expect(payload.client_mutation_id).toBe("m1");
  });

  it("tracks in-process metrics counters", () => {
    incrementMetric("api_requests", { route: "sales.process", outcome: "ok" });
    incrementMetric("api_requests", { route: "sales.process", outcome: "ok" });
    const snapshot = readMetricsSnapshot();
    expect(snapshot).toEqual([
      {
        name: "api_requests",
        labels: { outcome: "ok", route: "sales.process" },
        value: 2,
      },
    ]);
  });

  it("reports liveness without dependencies", () => {
    const live = buildLiveness();
    expect(live.status).toBe("ok");
    expect(live.service).toBe("nexgestaovendas");
  });

  it("marks readiness not_ready when auth env is absent", async () => {
    const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const readiness = await checkReadiness();
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey;
    expect(readiness.status).toBe("not_ready");
    expect(readiness.checks.database).toBe("not_configured");
  });
});

describe("reliability recovery helpers", () => {
  it("applies exponential backoff with a hard cap", () => {
    expect(backoffDelayMs(0, () => 0)).toBe(500);
    expect(backoffDelayMs(10, () => 1)).toBe(60_000);
    expect(shouldMarkOutboxFailed(MAX_TRANSIENT_FAILURES - 1)).toBe(false);
    expect(shouldMarkOutboxFailed(MAX_TRANSIENT_FAILURES)).toBe(true);
  });

  it("blocks unsafe retries for synced/conflict/failed commands", () => {
    const now = "2026-09-04T12:00:00.000Z";
    expect(
      canSafelyRetryOutbox(
        { status: "pending", attemptCount: 1, clientMutationId: "m1", nextAttemptAt: now },
        now
      )
    ).toBe(true);
    expect(
      canSafelyRetryOutbox(
        { status: "synced", attemptCount: 1, clientMutationId: "m1" },
        now
      )
    ).toBe(false);
    expect(
      canSafelyRetryOutbox(
        { status: "conflict", attemptCount: 3, clientMutationId: "m1", outcomeUnknown: true },
        now
      )
    ).toBe(false);
  });

  it("asserts single financial effect under replay", () => {
    expect(
      assertSingleFinancialEffect({ localWrites: 1, serverReplay: true, expectedWrites: 1 })
    ).toBe(true);
    expect(
      assertSingleFinancialEffect({ localWrites: 2, serverReplay: true, expectedWrites: 1 })
    ).toBe(false);
  });

  it("documents backup/recovery limitations without inventing automation", () => {
    const limitations = describeBackupRecoveryLimitations();
    expect(limitations.automatedBackup).toBe(false);
    expect(limitations.notes.length).toBeGreaterThan(0);
  });
});

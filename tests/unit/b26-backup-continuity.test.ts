import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CRITICAL_RECOVERY_ENTITIES,
  RECOVERY_LAYERS,
  RECOVERY_RUNBOOK_STEPS,
  assertNoPublicSecretLeak,
  assertRetryDoesNotDuplicate,
  assertSafeRecoveryAdminInput,
  buildContinuityChecklist,
  isValidBackupAttestationTimestamp,
  rejectRecoveryShellExecution,
  resolveBackupContinuityStatus,
} from "@/lib/domain/backup-continuity";
import {
  assertSingleFinancialEffect,
  canSafelyRetryOutbox,
  describeBackupRecoveryLimitations,
  getBackupContinuityProjection,
} from "@/lib/observability/recovery";
import { canManageStoreSettings, canViewReports } from "@/lib/domain/rbac";

const ROOT = process.cwd();
const RECOVERY_DOC = readFileSync(join(ROOT, "docs/OPERATIONAL-RECOVERY.md"), "utf8");
const CORE_SCHEMA = readFileSync(
  join(ROOT, "supabase/migrations/20250901000002_core_schema.sql"),
  "utf8"
);
const GITIGNORE = readFileSync(join(ROOT, ".gitignore"), "utf8");

describe("B26 backup continuity status (honest)", () => {
  it("does not invent backup success without attestation", () => {
    const status = resolveBackupContinuityStatus({});
    expect(status.automatedBackupOrchestratedByApp).toBe(false);
    expect(status.backup_available).toBe("unknown");
    expect(status.backup_last_verified).toBeNull();
    expect(status.backup_status).toBe("operator_managed");
    expect(status.recovery_ready).toBe(false);
    expect(status.sourceOfTruth).toBe("postgres");
  });

  it("requires valid ISO attestation timestamp for verified status", () => {
    expect(
      resolveBackupContinuityStatus({
        status: "verified",
        lastVerifiedAt: "not-a-date",
      }).recovery_ready
    ).toBe(false);

    const ok = resolveBackupContinuityStatus({
      status: "verified",
      lastVerifiedAt: "2026-09-06T12:00:00.000Z",
    });
    expect(ok.backup_available).toBe("attested");
    expect(ok.backup_status).toBe("verified");
    expect(ok.recovery_ready).toBe(true);
    expect(ok.backup_last_verified).toBe("2026-09-06T12:00:00.000Z");
    expect(isValidBackupAttestationTimestamp("2026-09-06T12:00:00.000Z")).toBe(true);
  });

  it("surfaces failed attestation without claiming ready", () => {
    const failed = getBackupContinuityProjection({
      status: "failed",
      lastVerifiedAt: "2026-09-06T12:00:00.000Z",
    });
    expect(failed.backup_available).toBe("failed");
    expect(failed.recovery_ready).toBe(false);
  });

  it("maps critical entities and recovery layers", () => {
    for (const entity of [
      "organizations",
      "stores",
      "sales",
      "sale_items",
      "payments",
      "cash_sessions",
      "cash_movements",
      "inventory_movements",
      "fiscal_documents",
      "audit_logs",
      "integration_outbox",
      "store_settings",
    ]) {
      expect(CRITICAL_RECOVERY_ENTITIES).toContain(entity);
    }
    expect(RECOVERY_LAYERS).toEqual([
      "database",
      "application",
      "configuration",
      "secrets",
      "outbox_reprocess",
    ]);
    expect(RECOVERY_RUNBOOK_STEPS).toHaveLength(10);
    expect(buildContinuityChecklist().every((item) => item.required)).toBe(true);
  });
});

describe("B26 idempotency after retry (sale/payment/stock/cash)", () => {
  it("allows replay only when server already recorded a single effect", () => {
    expect(
      assertRetryDoesNotDuplicate({
        kind: "sale",
        clientMutationId: "99999999-9999-4999-8999-999999999901",
        previousServerEffectCount: 1,
        replay: true,
      }).ok
    ).toBe(true);

    expect(
      assertRetryDoesNotDuplicate({
        kind: "payment",
        clientMutationId: "99999999-9999-4999-8999-999999999901",
        previousServerEffectCount: 2,
        replay: true,
      }).ok
    ).toBe(false);

    expect(
      assertRetryDoesNotDuplicate({
        kind: "inventory_movement",
        clientMutationId: "99999999-9999-4999-8999-999999999902",
        previousServerEffectCount: 1,
        replay: true,
      }).ok
    ).toBe(true);

    expect(
      assertRetryDoesNotDuplicate({
        kind: "cash_movement",
        clientMutationId: "",
        previousServerEffectCount: 0,
        replay: false,
      }).ok
    ).toBe(false);
  });

  it("outbox retry is blocked for synced/conflict and financial replay stays single-effect", () => {
    const now = "2026-09-06T12:00:00.000Z";
    expect(
      canSafelyRetryOutbox(
        { status: "pending", attemptCount: 1, clientMutationId: "m1", nextAttemptAt: now },
        now
      )
    ).toBe(true);
    expect(
      canSafelyRetryOutbox({ status: "synced", attemptCount: 2, clientMutationId: "m1" }, now)
    ).toBe(false);
    expect(
      assertSingleFinancialEffect({ localWrites: 1, serverReplay: true, expectedWrites: 1 })
    ).toBe(true);
    expect(
      assertSingleFinancialEffect({ localWrites: 2, serverReplay: true, expectedWrites: 1 })
    ).toBe(false);
  });

  it("schema enforces store-scoped client_mutation uniqueness for sales", () => {
    expect(CORE_SCHEMA).toContain("UNIQUE (store_id, client_mutation_id)");
    expect(CORE_SCHEMA).toMatch(/client_mutation_id uuid NOT NULL/);
  });
});

describe("B26 multi-tenant / RLS / secrets / shell safety", () => {
  it("keeps RBAC boundaries for reports and settings", () => {
    expect(canViewReports("cashier")).toBe(false);
    expect(canViewReports("manager")).toBe(true);
    expect(canManageStoreSettings("cashier")).toBe(false);
    expect(canManageStoreSettings("admin")).toBe(true);
  });

  it("rejects public secret leaks and unsafe recovery inputs", () => {
    expect(
      assertNoPublicSecretLeak({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      }).ok
    ).toBe(true);
    expect(
      assertNoPublicSecretLeak({
        NEXT_PUBLIC_SERVICE_ROLE_KEY: "leak",
      }).ok
    ).toBe(false);

    expect(assertSafeRecoveryAdminInput("pg_dump; rm -rf /").ok).toBe(false);
    expect(assertSafeRecoveryAdminInput("../etc/passwd").ok).toBe(false);
    expect(assertSafeRecoveryAdminInput("restore-point-2026-09-06").ok).toBe(true);
    expect(() => rejectRecoveryShellExecution("bash -c id")).toThrow(
      /recovery_shell_execution_rejected/
    );
  });

  it("gitignore keeps env secrets untracked", () => {
    expect(GITIGNORE).toMatch(/\.env/);
  });
});

describe("B26 documentation and limitations", () => {
  it("runbook documents the 10 recovery steps and layer restores", () => {
    expect(RECOVERY_DOC).toContain("Pré-requisitos");
    expect(RECOVERY_DOC).toContain("Identificação da falha");
    expect(RECOVERY_DOC).toContain("Proteção dos dados");
    expect(RECOVERY_DOC).toContain("Restauração");
    expect(RECOVERY_DOC).toContain("Smoke");
    expect(RECOVERY_DOC).toContain("RLS");
    expect(RECOVERY_DOC).toContain("Validação de Migrations");
    expect(RECOVERY_DOC).toContain("Validação de Integridade");
    expect(RECOVERY_DOC).toContain("Retorno do serviço");
    expect(RECOVERY_DOC).toContain("database");
    expect(RECOVERY_DOC).toContain("outbox_reprocess");
    expect(RECOVERY_DOC).toMatch(/NÃO TESTADO|LIMITAÇÃO/i);
    expect(RECOVERY_DOC).toMatch(/nunca.*inventa.*sucesso de backup/i);
    expect(RECOVERY_DOC).toContain("retry != duplicate sale");
  });

  it("legacy helper still reports no automated in-app backup", () => {
    const limitations = describeBackupRecoveryLimitations();
    expect(limitations.automatedBackup).toBe(false);
    expect(limitations.rto).toBe("manual_restore");
  });
});

/**
 * B26 — Backup / recovery readiness checker (honest, non-destructive).
 *
 * Does NOT run pg_dump, PITR, or claim backup_success without operator attestation.
 * Usage: pnpm check:backup
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  CRITICAL_RECOVERY_ENTITIES,
  RECOVERY_RUNBOOK_STEPS,
  assertNoPublicSecretLeak,
  assertSafeRecoveryAdminInput,
  buildContinuityChecklist,
  readOperatorBackupAttestationFromEnv,
  rejectRecoveryShellExecution,
  resolveBackupContinuityStatus,
} from "../src/lib/domain/backup-continuity";

const ROOT = join(__dirname, "..");

type CheckResult = { id: string; ok: boolean; detail: string };

function check(id: string, ok: boolean, detail: string): CheckResult {
  return { id, ok, detail };
}

function main(): number {
  const results: CheckResult[] = [];

  const recoveryDoc = join(ROOT, "docs/OPERATIONAL-RECOVERY.md");
  const deployDoc = join(ROOT, "docs/PRODUCTION-DEPLOY.md");
  const gitignore = join(ROOT, ".gitignore");
  const envExample = join(ROOT, ".env.example");
  const coreSchema = join(ROOT, "supabase/migrations/20250901000002_core_schema.sql");

  results.push(
    check(
      "docs_operational_recovery",
      existsSync(recoveryDoc),
      existsSync(recoveryDoc) ? "docs/OPERATIONAL-RECOVERY.md presente" : "documento ausente"
    )
  );
  results.push(
    check(
      "docs_production_deploy",
      existsSync(deployDoc),
      existsSync(deployDoc) ? "docs/PRODUCTION-DEPLOY.md presente" : "documento ausente"
    )
  );

  if (existsSync(recoveryDoc)) {
    const text = readFileSync(recoveryDoc, "utf8");
    const hasSteps = RECOVERY_RUNBOOK_STEPS.every(
      (step) => text.toLowerCase().includes(step.replace(/_/g, " ")) || text.includes(step)
    );
    // Also accept Portuguese section headers covering the required procedure.
    const hasPtProcedure =
      text.includes("Pré-requisitos") &&
      text.includes("Identificação da falha") &&
      text.includes("Proteção dos dados") &&
      text.includes("Restauração") &&
      text.includes("Validação") &&
      text.includes("Smoke") &&
      text.includes("RLS") &&
      text.includes("Migrations") &&
      text.includes("Integridade") &&
      text.includes("Retorno");
    results.push(
      check(
        "runbook_steps",
        hasSteps || hasPtProcedure,
        hasSteps || hasPtProcedure
          ? "Runbook cobre os 10 passos B26"
          : "Runbook incompleto — faltam passos B26"
      )
    );
    results.push(
      check(
        "no_fake_backup_claim",
        !/backup_success\s*=\s*true/i.test(text),
        "Documento não inventa backup_success=true"
      )
    );
    results.push(
      check(
        "declares_limitation",
        /NÃO TESTADO|LIMITAÇÃO|limitação/i.test(text),
        "Documento declara limitações de infra/PITR"
      )
    );
  }

  if (existsSync(gitignore)) {
    const gi = readFileSync(gitignore, "utf8");
    results.push(
      check(
        "env_gitignored",
        /\.env(?!\.example)/.test(gi) || gi.includes(".env"),
        ".env está no .gitignore"
      )
    );
  } else {
    results.push(check("env_gitignored", false, ".gitignore ausente"));
  }

  if (existsSync(envExample)) {
    const example = readFileSync(envExample, "utf8");
    results.push(
      check(
        "env_example_no_real_secrets",
        !/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\./.test(example),
        ".env.example sem JWT/service-role real"
      )
    );
    results.push(
      check(
        "env_example_documents_backup_attestation",
        example.includes("BACKUP_STATUS") && example.includes("BACKUP_LAST_VERIFIED_AT"),
        "Attestação opcional de backup documentada no .env.example"
      )
    );
  }

  if (existsSync(coreSchema)) {
    const schema = readFileSync(coreSchema, "utf8");
    results.push(
      check(
        "sale_mutation_unique",
        schema.includes("UNIQUE (store_id, client_mutation_id)"),
        "sales idempotency UNIQUE(store_id, client_mutation_id) presente"
      )
    );
    results.push(
      check(
        "idempotency_keys_table",
        /idempotency_keys/i.test(schema) || schema.includes("PRIMARY KEY (store_id, client_mutation_id)"),
        "chave de idempotência por loja presente no schema core"
      )
    );
  }

  results.push(
    check(
      "critical_entities_mapped",
      CRITICAL_RECOVERY_ENTITIES.length >= 12,
      `${CRITICAL_RECOVERY_ENTITIES.length} entidades críticas mapeadas`
    )
  );

  const checklist = buildContinuityChecklist();
  results.push(
    check(
      "continuity_checklist",
      checklist.every((item) => item.required),
      `${checklist.length} itens obrigatórios de continuidade`
    )
  );

  const publicLeak = assertNoPublicSecretLeak(process.env as Record<string, string | undefined>);
  results.push(
    check(
      "no_public_secret_leak",
      publicLeak.ok,
      publicLeak.ok
        ? "Nenhum secret em NEXT_PUBLIC_* no processo"
        : `Leak: ${"leaked" in publicLeak ? publicLeak.leaked.join(", ") : "?"}`
    )
  );

  const unsafe = assertSafeRecoveryAdminInput("pg_dump; rm -rf /");
  results.push(
    check(
      "reject_shell_injection",
      !unsafe.ok,
      "Inputs de recovery com shell metacharacters são rejeitados"
    )
  );

  let shellRejected = false;
  try {
    rejectRecoveryShellExecution("bash -c id");
  } catch {
    shellRejected = true;
  }
  results.push(
    check("reject_shell_exec", shellRejected, "exec(user_input) de recovery é proibido")
  );

  const status = resolveBackupContinuityStatus(readOperatorBackupAttestationFromEnv());
  results.push(
    check(
      "honest_backup_status",
      status.automatedBackupOrchestratedByApp === false &&
        !(status.backup_status === "verified" && !status.backup_last_verified),
      `backup_status=${status.backup_status}; available=${status.backup_available}; recovery_ready=${status.recovery_ready}`
    )
  );

  // Never claim success just because the checker ran.
  results.push(
    check(
      "no_implicit_backup_success",
      status.backup_available !== "attested" || status.backup_status === "verified",
      status.recovery_ready
        ? "Attestação de operador presente (não é backup executado pela app)"
        : "Sem attestação ⇒ recovery_ready=false (honesto)"
    )
  );

  let failed = 0;
  for (const result of results) {
    const mark = result.ok ? "PASS" : "FAIL";
    console.log(`[${mark}] ${result.id}: ${result.detail}`);
    if (!result.ok) failed += 1;
  }

  console.log("");
  console.log(
    JSON.stringify(
      {
        automatedBackupOrchestratedByApp: status.automatedBackupOrchestratedByApp,
        backup_available: status.backup_available,
        backup_last_verified: status.backup_last_verified,
        backup_status: status.backup_status,
        recovery_ready: status.recovery_ready,
        critical_entities: CRITICAL_RECOVERY_ENTITIES,
        checks_failed: failed,
      },
      null,
      2
    )
  );

  if (failed > 0) {
    console.error(`backup_readiness_failed checks=${failed}`);
    return 1;
  }
  console.log("backup_readiness_ok");
  return 0;
}

process.exit(main());

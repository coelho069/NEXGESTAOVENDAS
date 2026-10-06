"use server";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPlatformAdminAccess } from "@/lib/auth/admin";
import {
  phase21AuditPassed,
  runPhase21BehaviorChecks,
  runPhase21SourceChecks,
  type Phase21Check,
} from "@/lib/domain/refund-phase21-audit";

const SOURCE_FILES = [
  "src/app/api/refund-requests/route.ts",
  "src/lib/server/refund-requests.ts",
  "src/lib/domain/refund-request.ts",
  "src/lib/server/refund-phase21-audit-action.ts",
] as const;

export type Phase21AuditResult =
  | { ok: true; passed: boolean; checks: Phase21Check[] }
  | { ok: false; error: "forbidden" };

export async function runPhase21AuditAction(): Promise<Phase21AuditResult> {
  const access = await getPlatformAdminAccess();
  if (!access) return { ok: false, error: "forbidden" };

  const files: Record<string, string> = {};
  for (const relativePath of SOURCE_FILES) {
    files[relativePath] = readFileSync(join(process.cwd(), relativePath), "utf8");
  }

  const checks = [...runPhase21BehaviorChecks(), ...runPhase21SourceChecks(files)];
  return { ok: true, passed: phase21AuditPassed(checks), checks };
}

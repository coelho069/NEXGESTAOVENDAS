// Regression guard: the anonymous paid-LLM routes were removed (orphaned, no UI, no contract).
// Re-adding either route requires a deliberate decision: auth, quota and cost limits first.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const REMOVED_ROUTE_FILES = [
  "src/app/api/hermes/chat/route.ts",
  "src/app/api/advisor/analyze/route.ts",
  "deploy/src/app/api/hermes/chat/route.ts",
];
// Advisor panel and its JEV-only library were removed (orphaned; see run-4 evidence).
const REMOVED_ADVISOR_MODULES = [
  "advisor-analysis-panel",
  "lib/advisor/jev-client",
  "lib/advisor/prompt",
  "lib/advisor/questions",
  "lib/advisor/validate",
  "lib/advisor/view-model",
  "lib/advisor/types",
  "advisor-jev.test",
];
const SCAN_ROOTS = ["src", "deploy/src", "tests"];
const FORBIDDEN_STRINGS = ["/api/hermes/chat", "/api/advisor/analyze"];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|json)$/.test(name)) out.push(p);
  }
  return out;
}

describe("rotas pagas anônimas (Hermes e Advisor) removidas", () => {
  it("nenhum handler de rota existe nos caminhos removidos", () => {
    for (const f of REMOVED_ROUTE_FILES) {
      expect(existsSync(join(ROOT, f)), f).toBe(false);
    }
  });

  it("nenhum arquivo de código ou teste referencia as rotas removidas", () => {
    const self = relative(ROOT, __filename).replace(/\\/g, "/");
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of walk(join(ROOT, root))) {
        const rel = relative(ROOT, file).replace(/\\/g, "/");
        if (rel === self) continue;
        const text = readFileSync(file, "utf8");
        if (FORBIDDEN_STRINGS.some((s) => text.includes(s))) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("nenhum código ou teste importa os módulos do Advisor removidos", () => {
    const importers: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of walk(join(ROOT, root))) {
        const rel = relative(ROOT, file).replace(/\\/g, "/");
        if (rel === relative(ROOT, __filename).replace(/\\/g, "/")) continue;
        const text = readFileSync(file, "utf8");
        if (REMOVED_ADVISOR_MODULES.some((m) => text.includes(m))) importers.push(rel);
      }
    }
    expect(importers).toEqual([]);
  });
});

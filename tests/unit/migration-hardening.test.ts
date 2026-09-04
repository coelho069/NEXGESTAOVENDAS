import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Verifies the FINAL state of the whole migration chain, not per-file text.
 * Guards against regressions where a legacy migration keeps a
 * profiles.default_role authorization fallback or an unpinned search_path
 * that is only acceptable when a later migration supersedes it.
 */

const MIGRATIONS_DIR = "supabase/migrations";

type FunctionState = {
  name: string;
  searchPath: string | null;
  from2026: boolean;
  body: string;
};

function readMigrations(): Array<{ file: string; sql: string }> {
  return readdirSync(join(process.cwd(), MIGRATIONS_DIR))
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({
      file,
      sql: readFileSync(join(process.cwd(), MIGRATIONS_DIR, file), "utf8"),
    }));
}

function buildFinalFunctionState(
  migrations: Array<{ file: string; sql: string }>
): Map<string, FunctionState> {
  const state = new Map<string, FunctionState>();

  for (const { file, sql } of migrations) {
    const createRegex =
      /CREATE OR REPLACE FUNCTION public\.(\w+)\s*\(([\s\S]*?)\)\s*RETURNS[\s\S]*?AS \$\$([\s\S]*?)\$\$;/g;
    for (const match of sql.matchAll(createRegex)) {
      const name = match[1];
      const body = match[3] ?? "";
      const preBody = match[0].slice(0, match[0].indexOf("AS $$"));
      const searchPath = preBody.match(/SET search_path\s*=\s*([^\n;]+)/i)?.[1]?.trim() ?? null;
      if (!name) continue;
      state.set(name, { name, searchPath, from2026: file.startsWith("2026"), body });
    }

    for (const match of sql.matchAll(
      /ALTER FUNCTION public\.(\w+)\s*\([^)]*\)\s*SET search_path\s*=\s*([^;\n]+);/g
    )) {
      const name = match[1];
      const searchPath = match[2]?.trim();
      const previous = state.get(name);
      if (previous && searchPath) state.set(name, { ...previous, searchPath });
    }

    for (const match of sql.matchAll(
      /ALTER FUNCTION public\.(\w+)\s*\([^)]*\)\s*RENAME TO\s+(\w+);/g
    )) {
      const from = match[1];
      const to = match[2];
      const previous = state.get(from);
      if (previous && to) {
        state.delete(from);
        state.set(to, { ...previous, name: to });
      }
    }
  }

  return state;
}

function buildFinalPolicyState(
  migrations: Array<{ file: string; sql: string }>
): Map<string, boolean> {
  // name -> whether the FINAL action keeps a default_role-based policy alive.
  const state = new Map<string, boolean>();
  for (const { sql } of migrations) {
    for (const match of sql.matchAll(/CREATE POLICY (\w+) ON[\s\S]*?;/g)) {
      const name = match[1];
      if (name) state.set(name, match[0].includes("default_role"));
    }
    for (const match of sql.matchAll(/DROP POLICY IF EXISTS (\w+) ON/g)) {
      const name = match[1];
      if (name) state.set(name, false);
    }
  }
  return state;
}

describe("final migration chain state (RBAC hardening regression net)", () => {
  const migrations = readMigrations();
  const functions = buildFinalFunctionState(migrations);
  const policies = buildFinalPolicyState(migrations);
  const chain = migrations.map((migration) => migration.sql).join("\n");

  it("finds the expected migration chain", () => {
    expect(migrations.length).toBeGreaterThanOrEqual(8);
  });

  it("keeps every final function body free of profiles.default_role", () => {
    const offenders = [...functions.values()].filter(
      (fn) => fn.name !== "profiles_provisioning_guard" && fn.body.includes("default_role")
    );
    expect(offenders).toEqual([]);
  });

  it("ends every default_role-based legacy policy in a DROP", () => {
    const offenders = [...policies.entries()].filter(([, usesDefaultRole]) => usesDefaultRole);
    expect(offenders).toEqual([]);
  });

  it("pins search_path on every function created by the hardening migrations", () => {
    const offenders = [...functions.values()].filter((fn) => {
      if (!fn.from2026) return false;
      const path = fn.searchPath ?? "";
      return !(/pg_catalog/.test(path) && /pg_temp/.test(path));
    });
    expect(offenders).toEqual([]);
  });

  it("keeps the dynamic SECURITY DEFINER search_path backstop for legacy functions", () => {
    expect(chain).toMatch(/prosecdef/);
    expect(chain).toMatch(
      /ALTER FUNCTION %s SET search_path = pg_catalog, public, pg_temp/
    );
  });

  it("keeps the data-integrity guards installed", () => {
    expect(chain).toContain("profiles_provisioning_guard");
    expect(chain).toContain("fk_store_members_store_same_org");
  });

  it("enforces normalized barcode uniqueness per organization without banning NULL/blank values", () => {
    expect(chain).toContain("CREATE UNIQUE INDEX products_org_barcode_key");
    expect(chain).toContain("ON public.products (org_id, lower(btrim(barcode)))");
    expect(chain).toContain("WHERE barcode IS NOT NULL AND btrim(barcode) <> ''");
  });

  it("enforces inventory mutation identity and import-row uniqueness", () => {
    expect(chain).toContain("ADD COLUMN IF NOT EXISTS client_mutation_id uuid");
    expect(chain).toContain("ADD COLUMN IF NOT EXISTS import_id uuid");
    expect(chain).toContain("ADD COLUMN IF NOT EXISTS import_row integer");
    expect(chain).toContain("CREATE UNIQUE INDEX inventory_movements_store_mutation_key");
    expect(chain).toContain("CREATE UNIQUE INDEX inventory_movements_import_row_key");
    expect(chain).toContain("pg_advisory_xact_lock");
    expect(chain).toContain("idempotency_payload_mismatch");
  });
});

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regressão da remediação P0 (run-5, agente A):
 * A1 - cost_price de products não legível por authenticated via Data API.
 * A2 - cancel_sale, process_sale_return, retry_fiscal_operation e
 *      request_fiscal_reconcile aplicam a mesma regra de papel das rotas.
 * A validação real em Postgres está em scripts locais (não executada em produção).
 */

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const A1_FILE = "20261016100000_products_cost_price_column_grant.sql";
const A2_SALE_FILE = "20261016110000_sale_return_cancel_role_gates.sql";
const A2_FISCAL_FILE = "20261016120000_fiscal_retry_reconcile_role_gates.sql";

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listSourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

function read(file: string): string {
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `definição de ${name} ausente`).toBeGreaterThan(-1);
  const end = sql.indexOf("\n$$;", start);
  expect(end, `fim de ${name} ausente`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("A1 - products.cost_price fora do SELECT de authenticated", () => {
  it("cria migração nova que revoga SELECT de tabela e concede SELECT por coluna sem cost_price", () => {
    expect(existsSync(join(MIGRATIONS, A1_FILE))).toBe(true);
    const sql = read(A1_FILE);
    expect(sql).toContain("REVOKE SELECT ON TABLE public.products FROM authenticated;");
    const grant = sql.slice(sql.indexOf("GRANT SELECT ("), sql.indexOf("TO authenticated", sql.indexOf("GRANT SELECT (")));
    expect(grant).toContain("unit_price");
    expect(grant).toContain("is_active");
    expect(grant).not.toMatch(/\bcost_price\b/);
  });

  it("nenhuma migração posterior volta a conceder SELECT de tabela em products", () => {
    const later = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql") && f > A1_FILE)
      .map((f) => ({ f, sql: read(f) }));
    for (const { f, sql } of later) {
      expect(sql, f).not.toMatch(/GRANT\s+SELECT\s+ON\s+(TABLE\s+)?public\.products\s+TO\s+authenticated/i);
    }
  });

  it("nenhum consumidor de sessão do app seleciona cost_price de products", () => {
    for (const file of listSourceFiles(join(process.cwd(), "src"))) {
      const text = readFileSync(file, "utf8");
      const selects = text.match(/from\("products"\)\s*\.select\("([^"]*)"\)/g) ?? [];
      for (const s of selects) expect(s, file).not.toContain("cost_price");
    }
  });
});

describe("A2 - papéis de venda e fiscal no banco", () => {
  it("process_sale_return: cancel só admin/manager; return admin/manager/cashier", () => {
    const body = functionBody(read(A2_SALE_FILE), "process_sale_return");
    expect(body).not.toContain("v_operation = 'cancel' AND v_role = 'cashier'");
    expect(body).toMatch(/v_operation = 'cancel'\s+AND v_role IS DISTINCT FROM 'admin'\s+AND v_role IS DISTINCT FROM 'manager'/);
    expect(body).toMatch(/v_operation = 'return'\s+AND v_role IS DISTINCT FROM 'admin'\s+AND v_role IS DISTINCT FROM 'manager'\s+AND v_role IS DISTINCT FROM 'cashier'/);
    expect(body).toContain("SECURITY DEFINER");
    expect(body).toContain("SET search_path = pg_catalog, public, pg_temp");
  });

  it("cancel_sale: exige admin/manager antes de montar os itens", () => {
    const body = functionBody(read(A2_SALE_FILE), "cancel_sale");
    const gate = body.indexOf("'forbidden_sale_cancel'");
    const items = body.indexOf("SELECT COALESCE(jsonb_agg(");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(items);
    expect(body).toContain("IS DISTINCT FROM 'manager'");
  });

  it("retry_fiscal_operation e request_fiscal_reconcile: exigem admin/manager, NULL-safe", () => {
    const sql = read(A2_FISCAL_FILE);
    for (const name of ["retry_fiscal_operation", "request_fiscal_reconcile"]) {
      const body = functionBody(sql, name);
      expect(body, name).not.toContain("user_has_store_access(v_store_id)");
      expect(body, name).toContain("public.user_store_role(v_store_id) IS DISTINCT FROM 'admin'");
      expect(body, name).toContain("public.user_store_role(v_store_id) IS DISTINCT FROM 'manager'");
    }
  });

  it("as rotas continuam aplicando os mesmos gates de papel", () => {
    const domain = readFileSync(join(process.cwd(), "src/lib/domain/sale-return.ts"), "utf8");
    expect(domain).toMatch(/canCancelSale[\s\S]*role === "admin" \|\| role === "manager"/);
    expect(domain).toMatch(/canReturnSale[\s\S]*role === "cashier"/);
    const ret = readFileSync(join(process.cwd(), "src/app/api/sales/[id]/return/route.ts"), "utf8");
    expect(ret).toContain("canCancelSale");
    expect(ret).toContain("canReturnSale");
  });
});

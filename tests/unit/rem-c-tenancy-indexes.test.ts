import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Remediation C2 (P1): unicidade de SKU, código de barras e e-mail por organização.
 * Verificação estática da cadeia de migrations (sem Postgres).
 */

const MIGRATIONS_DIR = path.resolve(__dirname, "../../supabase/migrations");
const GLOBAL_INDEXES = [
  "products_sku_unique_idx",
  "products_barcode_unique_idx",
  "customers_email_unique_idx",
];
const NEW_MIGRATION = "20261016200000_tenancy_per_org_unique_indexes.sql";

function listMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function read(name: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
}

describe("C2: unicidade por organizacao (sem indice global entre tenants)", () => {
  it("a migration nova remove os tres indices globais", () => {
    const sql = read(NEW_MIGRATION);
    for (const index of GLOBAL_INDEXES) {
      expect(sql).toMatch(new RegExp(`DROP INDEX IF EXISTS public\\.${index};`));
    }
  });

  it("nenhuma migration posterior a 20261016200000 recria os indices globais", () => {
    const later = listMigrations().filter((name) => name > NEW_MIGRATION);
    for (const name of later) {
      const sql = read(name);
      for (const index of GLOBAL_INDEXES) {
        expect(sql, `${name} recria ${index}`).not.toContain(index);
      }
    }
  });

  it("a migration nova cria unicidade de cliente por organizacao (org_id, lower(email))", () => {
    const sql = read(NEW_MIGRATION);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS customers_org_email_unique_idx\s+ON public\.customers \(org_id, lower\(email\)\)\s+WHERE email IS NOT NULL;/
    );
  });

  it("a migration nova nao cria indice global de sku, barcode ou e-mail", () => {
    const sql = read(NEW_MIGRATION);
    expect(sql).not.toMatch(/CREATE UNIQUE INDEX[^;]*products_(sku|barcode)/);
    expect(sql).not.toMatch(/ON public\.customers \(lower\(email\)\)/);
  });

  it("a migration nova aborta explicitamente se houver e-mail duplicado na mesma org", () => {
    const sql = read(NEW_MIGRATION);
    expect(sql).toContain("customers_email_duplicate_within_org");
    expect(sql).toContain("GROUP BY org_id, lower(email)");
  });

  it("a unicidade por organizacao de produtos ja existe nas migrations anteriores", () => {
    const core = read("20250901000002_core_schema.sql");
    const barcode = read("20260903192557_enforce_product_barcode_uniqueness.sql");
    expect(core).toMatch(/UNIQUE \(org_id, sku\)/);
    expect(barcode).toContain("products_org_barcode_key");
    expect(barcode).toMatch(/ON public\.products \(org_id, lower\(btrim\(barcode\)\)\)/);
  });

  it("a migration nova nao altera migrations existentes (nome e faixa de timestamp)", () => {
    const names = listMigrations();
    expect(names).toContain(NEW_MIGRATION);
    expect(NEW_MIGRATION >= "20261016200000" && NEW_MIGRATION <= "20261016299999").toBe(true);
    // Migrações de remediação de outros agentes ficam em faixas reservadas (A: 20261016100000-199999).
    // Fora dessas faixas não pode haver timestamp colidindo com a remediação.
    const otherRemediation = names.filter((name) => name >= "20261016100000" && name !== NEW_MIGRATION);
    expect(otherRemediation.every((name) => name <= "20261016199999")).toBe(true);
  });
});

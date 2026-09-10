import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = "supabase/migrations";
const MIGRATION = "20260910160000_platform_admin_subscriptions_domain.sql";

function readMigration(fileName: string): string {
  return readFileSync(join(process.cwd(), MIGRATIONS_DIR, fileName), "utf8");
}

describe("platform admin subscriptions migration", () => {
  it("adds a forward-only migration after existing production migrations", () => {
    const files = readdirSync(join(process.cwd(), MIGRATIONS_DIR))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    expect(files).toContain(MIGRATION);
    expect(files.indexOf(MIGRATION)).toBeGreaterThan(
      files.indexOf("20260909193200_cash_walk_in_without_customer.sql")
    );
  });

  it("uses org_id and current subscription statuses", () => {
    const sql = readMigration(MIGRATION);
    expect(sql).toContain("org_id uuid NOT NULL REFERENCES public.organizations");
    expect(sql).toContain("'active'");
    expect(sql).toContain("'trialing'");
    expect(sql).toContain("'past_due'");
    expect(sql).toContain("'expired'");
    expect(sql).toContain("'canceled'");
    expect(sql).toContain("'cancelled'");
    expect(sql).not.toContain("organization_id");
    expect(sql).not.toMatch(/'pending'/);
  });

  it("protects platform_admins, plans and subscriptions with RLS and is_platform_admin", () => {
    const sql = readMigration(MIGRATION);
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.platform_admins");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.is_platform_admin()");
    expect(sql).toContain("ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("plans_insert_platform_admin");
    expect(sql).toContain("plans_update_platform_admin");
    expect(sql).toContain("plans_delete_platform_admin");
    expect(sql).toContain("subscriptions_insert_platform_admin");
    expect(sql).toContain("subscriptions_update_platform_admin");
    expect(sql).toContain("DROP POLICY IF EXISTS subscriptions_delete_platform_admin");
    expect(sql).toContain("USING (public.is_platform_admin() IS TRUE)");
    expect(sql).toContain("WITH CHECK (public.is_platform_admin() IS TRUE)");
    expect(sql).not.toMatch(/FROM\s+public\.store_members/i);
  });

  it("keeps subscription history and denies physical DELETE for admins", () => {
    const sql = readMigration(MIGRATION);
    expect(sql).toMatch(/ON DELETE RESTRICT/);
    expect(sql).toMatch(/REVOKE\s+DELETE\s+ON\s+TABLE\s+public\.subscriptions\s+FROM\s+authenticated/i);
    expect(sql).not.toMatch(/CREATE POLICY\s+subscriptions_delete_platform_admin/i);
    expect(sql).toContain("prevent_delete_plan_in_use");
  });

  it("does not expose write grants to anon", () => {
    const sql = readMigration(MIGRATION);
    expect(sql).not.toMatch(/GRANT\s+(INSERT|UPDATE|DELETE).*TO\s+anon/i);
    expect(sql).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.plans TO authenticated");
    expect(sql).toContain(
      "GRANT SELECT, INSERT, UPDATE ON TABLE public.subscriptions TO authenticated"
    );
  });
});

/**
 * Static guard on the client-accounts migration. The migration cannot be
 * applied here (no local Supabase stack), so the invariants that matter for
 * production are asserted against the SQL text.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(
    process.cwd(),
    "supabase/migrations/20261004150000_admin_client_accounts.sql"
  ),
  "utf8"
);

const middleware = readFileSync(path.resolve(process.cwd(), "src/middleware.ts"), "utf8");

describe("client accounts migration", () => {
  it("creates the two tables with the expected guards", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.client_accounts");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.client_account_events");
    expect(migration).toContain("email text NOT NULL");
    expect(migration).toContain("full_name text NOT NULL");
    // Foreign keys keep the tenant and billing links referential.
    expect(migration).toContain("REFERENCES public.organizations (id) ON DELETE RESTRICT");
    expect(migration).toContain("REFERENCES public.subscriptions (id) ON DELETE SET NULL");
  });

  it("enforces one account per e-mail, case-insensitively", () => {
    expect(migration).toContain("client_accounts_email_unique_idx");
    expect(migration).toContain("ON public.client_accounts (lower(email))");
  });

  it("never stores activation tokens or passwords", () => {
    // Comments explain the absence of secrets; the DDL must be clean.
    const ddl = migration
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

    expect(ddl.toLowerCase()).not.toContain("password");
    expect(ddl.toLowerCase()).not.toContain("token");
    expect(ddl.toLowerCase()).not.toContain("action_link");
    expect(ddl).not.toMatch(/\bsecret\b/i);
  });

  it("restricts every policy to platform admins", () => {
    const policies = migration.match(/CREATE POLICY[\s\S]*?;/g) ?? [];
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      expect(policy).toContain("is_platform_admin() IS TRUE");
      expect(policy).not.toContain("TO anon");
    }
  });

  it("grants no client-side insert or delete on the accounts table", () => {
    expect(migration).not.toMatch(
      /CREATE POLICY client_accounts_(insert|delete)/
    );
  });

  it("keeps the audit trail append-only", () => {
    expect(migration).toContain("client_account_events_append_only");
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON public.client_account_events");
  });

  it("does not touch subscription or payment state", () => {
    expect(migration).not.toMatch(/UPDATE\s+public\.subscriptions/i);
    expect(migration).not.toMatch(/UPDATE\s+public\.plans/i);
    expect(migration).not.toMatch(/UPDATE\s+public\.store_members/i);
    expect(migration).not.toMatch(/INSERT INTO\s+public\.platform_admins/i);
  });
});

describe("existing authentication surface is preserved", () => {
  it("keeps /admin behind authentication and keeps login untouched", () => {
    expect(middleware).toContain('request.nextUrl.pathname.startsWith("/admin")');
    expect(middleware).toContain('request.nextUrl.pathname.startsWith("/login")');
  });

  it("does not add the activation page to the protected prefixes", () => {
    // /ativar-conta must stay reachable with no session, otherwise the invite
    // link can never bootstrap the password.
    expect(middleware).not.toContain('startsWith("/ativar-conta")');
  });
});

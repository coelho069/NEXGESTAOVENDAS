import { describe, expect, it, vi, afterEach } from "vitest";
import {
  assertProductionConfigOrThrow,
  validateProductionConfig,
} from "@/lib/production/config";
import { resolveNextDistDir } from "@/lib/production/next-dist-dir";
import { checkReadiness } from "@/lib/observability/health";
import { pdvFixturesEnabled } from "@/lib/pdv/fixtures";

describe("production configuration fail-closed", () => {
  it("passes through in non-production", () => {
    const report = validateProductionConfig({ NODE_ENV: "development" });
    expect(report.ok).toBe(true);
    expect(report.fatal).toEqual([]);
  });

  it("rejects missing APP_ORIGIN and insecure supabase URL in production", () => {
    const report = validateProductionConfig({
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "http://insecure.example",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "short",
      APP_ORIGIN: "",
      NEXT_PUBLIC_PDV_FIXTURES: "1",
    });
    expect(report.ok).toBe(false);
    expect(report.fatal.map((issue) => issue.code).sort()).toEqual([
      "app_origin",
      "fixtures_enabled",
      "supabase_anon",
      "supabase_url",
    ]);
  });

  it("accepts a minimal valid production envelope", () => {
    const report = validateProductionConfig({
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-with-enough-length",
      APP_ORIGIN: "https://pdv.example.com",
      TRUST_PROXY: "1",
      FISCAL_WORKER_SECRET: "x".repeat(32),
    });
    expect(report.ok).toBe(true);
    expect(report.fatal).toEqual([]);
  });

  it("throws on assert when fatal issues exist", () => {
    expect(() =>
      assertProductionConfigOrThrow({
        NODE_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
        APP_ORIGIN: "",
      })
    ).toThrow(/production_config_invalid/);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("never enables fixtures when NODE_ENV is production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_PDV_FIXTURES", "1");
    expect(pdvFixturesEnabled()).toBe(false);
  });

  it("isolates Next distDir for E2E via NEX_NEXT_DIST_DIR", () => {
    expect(resolveNextDistDir({})).toBe(".next");
    expect(resolveNextDistDir({ NEX_NEXT_DIST_DIR: "  .next-e2e  " })).toBe(".next-e2e");
    expect(() => resolveNextDistDir({ NEX_NEXT_DIST_DIR: "/tmp/evil" })).toThrow(
      /invalid_nex_next_dist_dir/
    );
    expect(() => resolveNextDistDir({ NEX_NEXT_DIST_DIR: "../outside" })).toThrow(
      /invalid_nex_next_dist_dir/
    );
  });

  it("readiness includes production_config without leaking secrets", async () => {
    const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const readiness = await checkReadiness();
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey;
    expect(readiness.checks.production_config).toBeDefined();
    expect(JSON.stringify(readiness)).not.toMatch(/SERVICE_ROLE|password|secret_/i);
  });
});

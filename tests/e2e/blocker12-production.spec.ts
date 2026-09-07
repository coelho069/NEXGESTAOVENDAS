import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("production Dockerfile is non-root and healthchecked", () => {
  const dockerfile = readFileSync(resolve(process.cwd(), "Dockerfile"), "utf8");
  const nextConfig = readFileSync(resolve(process.cwd(), "next.config.mjs"), "utf8");
  expect(dockerfile).toContain("USER nextjs");
  expect(dockerfile).toContain("HEALTHCHECK");
  expect(dockerfile).toContain("server.js");
  expect(nextConfig).toContain('output: "standalone"');
  expect(nextConfig).toContain("distDir");
  expect(nextConfig).toContain("NEX_NEXT_DIST_DIR");
});

test("gitignore keeps env secrets untracked", () => {
  const gitignore = readFileSync(resolve(process.cwd(), ".gitignore"), "utf8");
  expect(gitignore).toMatch(/^\.env$/m);
  expect(gitignore).toContain(".env.*");
  expect(gitignore).toContain("!.env.example");
  expect(gitignore).toContain("*.pem");
  expect(gitignore).toContain(".next-e2e");
});

test("playwright webServer isolates Next distDir from production build", () => {
  const playwrightConfig = readFileSync(resolve(process.cwd(), "playwright.config.ts"), "utf8");
  expect(playwrightConfig).toContain('NEX_NEXT_DIST_DIR: e2eDistDir');
  expect(playwrightConfig).toContain('.next-e2e');
  expect(playwrightConfig).toContain("reuseExistingServer: !process.env.CI");
});

test("liveness remains free of secrets and always 200", async ({ request }) => {
  const response = await request.get("/health/liveness");
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).not.toMatch(/SERVICE_ROLE|password|private_key|FISCAL_WORKER/i);
});

test("deploy docs cover DR rollback and multi-instance limits", () => {
  const deploy = readFileSync(resolve(process.cwd(), "docs/PRODUCTION-DEPLOY.md"), "utf8");
  const recovery = readFileSync(resolve(process.cwd(), "docs/OPERATIONAL-RECOVERY.md"), "utf8");
  expect(deploy.toLowerCase()).toContain("fail-closed");
  expect(deploy).toContain("nex-atomic-deploy-check.sh");
  expect(deploy).toContain("ATOMIC_DEPLOY.md");
  expect(deploy).toContain("SAFE MULTI-INSTANCE");
  expect(recovery).toContain("RPO");
  expect(recovery).toContain("RTO");
  expect(recovery).toContain("NÃO TESTADO — LIMITAÇÃO DE INFRAESTRUTURA");
  expect(recovery).toContain("PITR");
});

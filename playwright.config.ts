import { defineConfig, devices } from "@playwright/test";

/**
 * E2E must never share the production build output directory.
 * `NEX_NEXT_DIST_DIR=.next-e2e` keeps Playwright's `pnpm dev` webServer off `.next`
 * so concurrent `pnpm build` cannot corrupt the app under test (and vice versa).
 */
const e2eDistDir = ".next-e2e";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    // In CI always start a dedicated server. Locally reuse only when already up.
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      NEX_NEXT_DIST_DIR: e2eDistDir,
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      NEXT_PUBLIC_PDV_FIXTURES: "1",
    },
  },
});

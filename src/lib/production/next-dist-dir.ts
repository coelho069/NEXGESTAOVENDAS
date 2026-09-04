/**
 * Resolve the Next.js `distDir` for this process.
 *
 * Production builds use the default `.next`. Playwright's webServer must set
 * `NEX_NEXT_DIST_DIR=.next-e2e` so `pnpm build` and `pnpm test:e2e` never share
 * the same output/cache directory when run concurrently.
 */
export function resolveNextDistDir(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string {
  const raw = env.NEX_NEXT_DIST_DIR?.trim();
  if (!raw) return ".next";

  if (raw.startsWith("/") || raw.split(/[\\/]/).includes("..")) {
    throw new Error(`invalid_nex_next_dist_dir:${raw}`);
  }

  return raw;
}

/**
 * Next.js server instrumentation — runs once when the Node server boots.
 * Used for production fail-closed configuration checks.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") return;
  if (process.env.NODE_ENV !== "production") return;

  const { assertProductionConfigOrThrow, validateProductionConfig } = await import(
    "@/lib/production/config"
  );
  const report = validateProductionConfig();
  for (const warning of report.warnings) {
    console.warn(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        msg: "production_config_warning",
        code: warning.code,
        detail: warning.message,
      })
    );
  }
  assertProductionConfigOrThrow();
}

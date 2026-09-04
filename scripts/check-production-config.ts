/**
 * Fail-closed production config checker for CI / pre-start.
 * Usage: NODE_ENV=production ... pnpm check:prod
 */
import {
  assertProductionConfigOrThrow,
  validateProductionConfig,
} from "../src/lib/production/config";

const report = validateProductionConfig();
for (const warning of report.warnings) {
  console.warn(`[warn] ${warning.code}: ${warning.message}`);
}
try {
  assertProductionConfigOrThrow();
  console.log("production_config_ok");
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

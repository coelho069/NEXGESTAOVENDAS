export type ProductionConfigIssue = {
  code: string;
  message: string;
  severity: "fatal" | "warning";
};

export type ProductionConfigReport = {
  ok: boolean;
  fatal: ProductionConfigIssue[];
  warnings: ProductionConfigIssue[];
};

type EnvBag = Record<string, string | undefined>;

function read(envSource: EnvBag, name: string): string {
  return envSource[name]?.trim() ?? "";
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Fail-closed production configuration gate.
 * Call at process boot (instrumentation) and from readiness when NODE_ENV=production.
 */
export function validateProductionConfig(
  envSource: EnvBag = process.env
): ProductionConfigReport {
  const fatal: ProductionConfigIssue[] = [];
  const warnings: ProductionConfigIssue[] = [];

  const nodeEnv = read(envSource, "NODE_ENV");
  if (nodeEnv !== "production") {
    return { ok: true, fatal, warnings };
  }

  const supabaseUrl = read(envSource, "NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = read(envSource, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const appOrigin = read(envSource, "APP_ORIGIN");
  const fixtures = read(envSource, "NEXT_PUBLIC_PDV_FIXTURES");
  const trustProxy = read(envSource, "TRUST_PROXY");
  const fiscalWorkerSecret = read(envSource, "FISCAL_WORKER_SECRET");
  const serviceRole = read(envSource, "SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !isHttpsUrl(supabaseUrl)) {
    fatal.push({
      code: "supabase_url",
      message: "NEXT_PUBLIC_SUPABASE_URL must be a https URL in production",
      severity: "fatal",
    });
  }
  if (!anonKey || anonKey.length < 20) {
    fatal.push({
      code: "supabase_anon",
      message: "NEXT_PUBLIC_SUPABASE_ANON_KEY is required in production",
      severity: "fatal",
    });
  }
  if (!appOrigin || !isHttpsUrl(appOrigin)) {
    fatal.push({
      code: "app_origin",
      message: "APP_ORIGIN must be a https public origin in production (CSRF fail-closed)",
      severity: "fatal",
    });
  }
  if (fixtures === "1") {
    fatal.push({
      code: "fixtures_enabled",
      message: "NEXT_PUBLIC_PDV_FIXTURES must not be enabled in production",
      severity: "fatal",
    });
  }

  if (trustProxy && trustProxy !== "1") {
    warnings.push({
      code: "trust_proxy_value",
      message: "TRUST_PROXY should be unset or exactly 1",
      severity: "warning",
    });
  }
  if (!trustProxy) {
    warnings.push({
      code: "trust_proxy_unset",
      message:
        "TRUST_PROXY is unset; X-Forwarded-For will be ignored for rate limiting (recommended behind a sanitizing proxy: TRUST_PROXY=1)",
      severity: "warning",
    });
  }

  if (fiscalWorkerSecret && fiscalWorkerSecret.length < 32) {
    fatal.push({
      code: "fiscal_worker_secret_weak",
      message: "FISCAL_WORKER_SECRET must be at least 32 characters when set",
      severity: "fatal",
    });
  }
  if (!fiscalWorkerSecret) {
    warnings.push({
      code: "fiscal_worker_unconfigured",
      message: "FISCAL_WORKER_SECRET unset; fiscal outbox worker stays unavailable (not_configured path)",
      severity: "warning",
    });
  }

  if (serviceRole && (serviceRole.startsWith("sb_publishable_") || serviceRole.includes("anon"))) {
    fatal.push({
      code: "service_role_looks_public",
      message: "SUPABASE_SERVICE_ROLE_KEY must not be a publishable/anon key",
      severity: "fatal",
    });
  }

  const paymentProvider = read(envSource, "PAYMENT_PROVIDER");
  if (
    paymentProvider &&
    (!read(envSource, "PAYMENT_PROVIDER_URL") || !read(envSource, "PAYMENT_PROVIDER_API_KEY"))
  ) {
    warnings.push({
      code: "payment_provider_incomplete",
      message: "PAYMENT_PROVIDER set without URL/API key; adapter must stay not_configured",
      severity: "warning",
    });
  }

  return {
    ok: fatal.length === 0,
    fatal,
    warnings,
  };
}

export function assertProductionConfigOrThrow(
  envSource: EnvBag = process.env
): ProductionConfigReport {
  const report = validateProductionConfig(envSource);
  if (!report.ok) {
    const detail = report.fatal.map((issue) => `${issue.code}: ${issue.message}`).join("; ");
    throw new Error(`production_config_invalid: ${detail}`);
  }
  return report;
}

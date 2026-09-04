import { createClient } from "@/lib/supabase/server";
import { validateProductionConfig } from "@/lib/production/config";

export type LivenessStatus = {
  status: "ok";
  service: string;
  checked_at: string;
};

export type ReadinessStatus = {
  status: "ready" | "not_ready";
  service: string;
  checked_at: string;
  checks: {
    auth_configured: boolean;
    production_config: "ok" | "invalid" | "skipped";
    database: "ok" | "unavailable" | "not_configured";
  };
};

export function buildLiveness(): LivenessStatus {
  return {
    status: "ok",
    service: "nexgestaovendas",
    checked_at: new Date().toISOString(),
  };
}

export async function checkReadiness(): Promise<ReadinessStatus> {
  const checkedAt = new Date().toISOString();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const authConfigured = Boolean(url && anonKey);
  const productionGate =
    process.env.NODE_ENV === "production"
      ? validateProductionConfig()
      : { ok: true, fatal: [], warnings: [] };
  const productionConfig: ReadinessStatus["checks"]["production_config"] =
    process.env.NODE_ENV === "production"
      ? productionGate.ok
        ? "ok"
        : "invalid"
      : "skipped";

  if (!authConfigured || !productionGate.ok) {
    return {
      status: "not_ready",
      service: "nexgestaovendas",
      checked_at: checkedAt,
      checks: {
        auth_configured: authConfigured,
        production_config: productionConfig,
        database: authConfigured ? "unavailable" : "not_configured",
      },
    };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("stores").select("id").limit(1);
    if (error) {
      return {
        status: "not_ready",
        service: "nexgestaovendas",
        checked_at: checkedAt,
        checks: {
          auth_configured: true,
          production_config: productionConfig,
          database: "unavailable",
        },
      };
    }
    return {
      status: "ready",
      service: "nexgestaovendas",
      checked_at: checkedAt,
      checks: {
        auth_configured: true,
        production_config: productionConfig,
        database: "ok",
      },
    };
  } catch {
    return {
      status: "not_ready",
      service: "nexgestaovendas",
      checked_at: checkedAt,
      checks: {
        auth_configured: true,
        production_config: productionConfig,
        database: "unavailable",
      },
    };
  }
}

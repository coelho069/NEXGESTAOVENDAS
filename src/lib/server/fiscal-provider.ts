import {
  HttpFiscalAdapter,
  NotConfiguredFiscalAdapter,
  type FiscalAdapter,
} from "@/lib/adapters/fiscal";

const DEFAULT_TIMEOUT_MS = 15_000;

export type FiscalProviderConfig =
  | {
      configured: true;
      provider: string;
      url: string;
      apiKey: string;
      timeoutMs: number;
    }
  | {
      configured: false;
      provider: "not_configured";
      reason: string;
    };

export function getFiscalProviderConfig(): FiscalProviderConfig {
  const provider = process.env.FISCAL_PROVIDER?.trim() || "";
  const url = process.env.FISCAL_PROVIDER_URL?.trim() || "";
  const apiKey = process.env.FISCAL_PROVIDER_API_KEY?.trim() || "";

  if (!provider || !url || !apiKey) {
    return {
      configured: false,
      provider: "not_configured",
      reason: "provider_not_configured",
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return {
      configured: false,
      provider: "not_configured",
      reason: "provider_url_invalid",
    };
  }
  if (
    !["http:", "https:"].includes(parsedUrl.protocol) ||
    parsedUrl.username ||
    parsedUrl.password ||
    (process.env.NODE_ENV === "production" && parsedUrl.protocol !== "https:")
  ) {
    return {
      configured: false,
      provider: "not_configured",
      reason: "provider_url_not_secure",
    };
  }

  return {
    configured: true,
    provider,
    url: parsedUrl.toString().replace(/\/+$/, ""),
    apiKey,
    timeoutMs: parseTimeout(process.env.FISCAL_PROVIDER_TIMEOUT_MS),
  };
}

export function getFiscalAdapter(expectedProvider?: string): FiscalAdapter {
  const config = getFiscalProviderConfig();
  if (!config.configured || (expectedProvider && expectedProvider !== config.provider)) {
    return new NotConfiguredFiscalAdapter();
  }

  return new HttpFiscalAdapter(config.provider, config.url, config.apiKey, {
    timeoutMs: config.timeoutMs,
  });
}

export function isFiscalProviderConfigured(): boolean {
  return getFiscalProviderConfig().configured;
}

function parseTimeout(raw: string | undefined): number {
  const value = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(value, 1_000), 60_000);
}

import {
  HttpFiscalAdapter,
  NotConfiguredFiscalAdapter,
  NfceFiscalAdapter,
  SatFiscalAdapter,
  getFiscalAdapterByKind,
  type FiscalAdapter,
  type KindFiscalPort,
} from "@/lib/adapters/fiscal";
import type { FiscalDocumentKind } from "@/lib/domain/fiscal";

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

export type PublicFiscalProviderStatus = {
  status: "configured" | "not_configured";
  provider: string;
  message: string;
  methods: {
    nfce: "configured" | "not_configured";
    sat: "configured" | "not_configured";
  };
};

export function getFiscalProviderConfig(
  envSource: NodeJS.Dict<string | undefined> = process.env
): FiscalProviderConfig {
  const provider = (envSource.FISCAL_PROVIDER ?? "").trim();
  const url = (envSource.FISCAL_PROVIDER_URL ?? "").trim();
  const apiKey = (envSource.FISCAL_PROVIDER_API_KEY ?? "").trim();

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
    (envSource.NODE_ENV === "production" && parsedUrl.protocol !== "https:")
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
    timeoutMs: parseTimeout(envSource.FISCAL_PROVIDER_TIMEOUT_MS),
  };
}

/**
 * Worker/outbox adapter resolution.
 * When raw env credentials exist, HttpFiscalAdapter may call the provider URL.
 * Product readiness for NFC-e/SAT is gated by {@link getPublicFiscalProviderStatus}.
 */
export function getFiscalAdapter(expectedProvider?: string): FiscalAdapter {
  const config = getFiscalProviderConfig();
  if (!config.configured || (expectedProvider && expectedProvider !== config.provider)) {
    return new NotConfiguredFiscalAdapter();
  }

  return new HttpFiscalAdapter(config.provider, config.url, config.apiKey, {
    timeoutMs: config.timeoutMs,
  });
}

export function getKindFiscalAdapter(kind: FiscalDocumentKind): KindFiscalPort {
  // Until certificate vault + SEFAZ/SAT hardware readiness exist, kind adapters
  // stay on the explicit not_configured path (never invent issued).
  if (!isFiscalPubliclyConfigured(kind)) {
    return getFiscalAdapterByKind(kind);
  }
  return kind === "sat" ? new SatFiscalAdapter() : new NfceFiscalAdapter();
}

export function isFiscalProviderConfigured(
  envSource: NodeJS.Dict<string | undefined> = process.env
): boolean {
  return getFiscalProviderConfig(envSource).configured;
}

export function isFiscalPubliclyConfigured(kind: FiscalDocumentKind = "nfce"): boolean {
  const status = getPublicFiscalProviderStatus();
  const method = kind === "sat" ? status.methods.sat : status.methods.nfce;
  return status.status === "configured" && method === "configured";
}

/**
 * Safe projection for settings/UI. Never includes URL, API key, or certificate material.
 *
 * B24 ships fiscal architecture without certificate vault / SEFAZ hardware readiness.
 * Even when FISCAL_PROVIDER_* env vars are present, public status stays not_configured
 * so the UI never claims NFC-e/SAT can authorize documents.
 */
export function getPublicFiscalProviderStatus(
  envSource: NodeJS.Dict<string | undefined> = process.env
): PublicFiscalProviderStatus {
  void getFiscalProviderConfig(envSource);

  return {
    status: "not_configured",
    provider: "not_configured",
    message:
      "Provedor fiscal não configurado; NFC-e/SAT não serão autorizados sem integração real.",
    methods: {
      nfce: "not_configured",
      sat: "not_configured",
    },
  };
}

function parseTimeout(raw: string | undefined): number {
  const value = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(value, 1_000), 60_000);
}

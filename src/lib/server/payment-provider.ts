/**
 * Server-only payment provider configuration.
 * Secrets never leave this module; public status helpers omit credentials.
 */

const DEFAULT_TIMEOUT_MS = 15_000;

export type PaymentProviderConfig =
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

export type PublicPaymentProviderStatus = {
  status: "configured" | "not_configured";
  provider: string;
  message: string;
  methods: {
    pix: "configured" | "not_configured";
    /** Aggregated card rail (credit+debit) for DB enum projection. */
    card: "configured" | "not_configured";
    credit_card: "configured" | "not_configured";
    debit_card: "configured" | "not_configured";
    tef: "configured" | "not_configured";
  };
};

export function getPaymentProviderConfig(
  envSource: NodeJS.Dict<string | undefined> = process.env
): PaymentProviderConfig {
  const provider = (envSource.PAYMENT_PROVIDER ?? "").trim();
  const url = (envSource.PAYMENT_PROVIDER_URL ?? "").trim();
  const apiKey = (envSource.PAYMENT_PROVIDER_API_KEY ?? "").trim();

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
    timeoutMs: parseTimeout(envSource.PAYMENT_PROVIDER_TIMEOUT_MS),
  };
}

export function isPaymentProviderConfigured(
  envSource: NodeJS.Dict<string | undefined> = process.env
): boolean {
  return getPaymentProviderConfig(envSource).configured;
}

/**
 * Safe projection for settings/UI. Never includes URL or API key.
 *
 * B22/B23 ship payment architecture without live HTTP/hardware clients.
 * Even when PAYMENT_PROVIDER_* env vars are present, public status stays
 * not_configured so the UI never claims electronic payments can capture.
 */
export function getPublicPaymentProviderStatus(
  envSource: NodeJS.Dict<string | undefined> = process.env
): PublicPaymentProviderStatus {
  // Touch config so incomplete env still participates in production warnings,
  // without ever exposing secrets or advertising a fake ready state.
  void getPaymentProviderConfig(envSource);

  return {
    status: "not_configured",
    provider: "not_configured",
    message:
      "Provedores de pagamento eletrônico não configurados; PIX/cartão/TEF não serão capturados.",
    methods: {
      pix: "not_configured",
      card: "not_configured",
      credit_card: "not_configured",
      debit_card: "not_configured",
      tef: "not_configured",
    },
  };
}

function parseTimeout(raw: string | undefined): number {
  const value = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(value, 1_000), 60_000);
}

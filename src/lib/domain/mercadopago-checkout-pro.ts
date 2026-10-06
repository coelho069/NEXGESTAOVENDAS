import { exactConfirmedMoney } from "@/lib/domain/checkout-payment-snapshot";
import { money, toMoneyString } from "@/lib/money";

/**
 * Mercado Pago Checkout Pro (Preference) — cobrança única / PIX via checkout
 * hospedado. Retorna init_point (produção) ou sandbox_init_point (sandbox).
 * Diferente do rail MP Assinaturas (preapproval_plan recorrente) e do rail MP
 * Orders (PIX QR). Isolado, fail-closed.
 */

/** Estrutura estável de uma Preference retornada por /checkout/preferences. */
export type MercadoPagoPreferenceSnapshot = {
  id: string;
  initPoint: string | null;
  sandboxInitPoint: string | null;
};

export const MERCADOPAGO_CHECKOUT_PRO_API_BASE = "https://api.mercadopago.com" as const;

export function parseMercadoPagoPreferenceResponse(body: unknown): MercadoPagoPreferenceSnapshot | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const id = record.id;
  if (typeof id !== "string" || id.length === 0) return null;
  return {
    id,
    initPoint: typeof record.init_point === "string" ? record.init_point : null,
    sandboxInitPoint: typeof record.sandbox_init_point === "string" ? record.sandbox_init_point : null,
  };
}

/** URLs de retorno hospedado (success/pending/failure) a partir de APP_ORIGIN. */
export function buildMercadoPagoBackUrls(
  appOrigin: string
): { success: string; failure: string; pending: string } {
  const origin = appOrigin.trim().replace(/\/$/, "") || "http://localhost:3000";
  return {
    success: `${origin}/pagamento/sucesso`,
    pending: `${origin}/pagamento/pendente`,
    failure: `${origin}/pagamento/falha`,
  };
}

export function resolveCheckoutProAppOrigin(
  envSource: Record<string, string | undefined> = process.env
): string {
  return envSource.APP_ORIGIN?.trim() || envSource.APP_URL?.trim() || "http://localhost:3000";
}

/** Normaliza valor BRL para a Preference (string decimal). Fecha fail-closed em zero. */
export function normalizeCheckoutProAmount(amount: string): string {
  const normalized = toMoneyString(money(amount));
  if (money(normalized).lte(0)) {
    throw new Error("invalid_checkout_pro_amount");
  }
  return normalized;
}

export const MERCADOPAGO_CHECKOUT_PRO_WEBHOOK_TYPES = ["payment"] as const;

export type MercadoPagoCheckoutProWebhookType =
  (typeof MERCADOPAGO_CHECKOUT_PRO_WEBHOOK_TYPES)[number];

export type MercadoPagoCheckoutProWebhookNotification = {
  id: string | number;
  type: string;
  action: string;
  live_mode?: boolean;
  data: { id?: string };
};

export type MercadoPagoCheckoutProPaymentSnapshot = {
  id: string;
  status: string;
  externalReference: string | null;
  preferenceId: string | null;
  payerEmail: string | null;
  transactionAmount: string | null;
  currencyId: string | null;
  dateApproved: string | null;
};

export type MercadoPagoCheckoutProPreferenceMetadata = {
  id: string;
  externalReference: string | null;
  metadata: Record<string, string>;
};

export function isMercadoPagoCheckoutProWebhookTypeAllowed(
  type: string
): type is MercadoPagoCheckoutProWebhookType {
  return (MERCADOPAGO_CHECKOUT_PRO_WEBHOOK_TYPES as readonly string[]).includes(type);
}

export function parseMercadoPagoCheckoutProWebhookNotification(
  body: unknown
): MercadoPagoCheckoutProWebhookNotification | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const id = record.id;
  const type = record.type;
  const action = record.action;
  const data = record.data;
  if (
    (typeof id !== "string" && typeof id !== "number") ||
    typeof type !== "string" ||
    typeof action !== "string" ||
    !data ||
    typeof data !== "object"
  ) {
    return null;
  }
  const dataRecord = data as Record<string, unknown>;
  return {
    id: id as string | number,
    type,
    action,
    live_mode: record.live_mode === true,
    data: {
      id: typeof dataRecord.id === "string" ? dataRecord.id : undefined,
    },
  };
}

export function parseMercadoPagoCheckoutProPaymentResponse(
  body: unknown
): MercadoPagoCheckoutProPaymentSnapshot | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const id = record.id;
  const status = record.status;
  if (
    (typeof id !== "string" && typeof id !== "number") ||
    typeof status !== "string" ||
    status.length === 0
  ) {
    return null;
  }

  const payer = record.payer;
  const payerEmail =
    payer && typeof payer === "object" && typeof (payer as Record<string, unknown>).email === "string"
      ? ((payer as Record<string, unknown>).email as string)
      : null;

  const currencyRaw = record.currency_id;
  const approvedRaw = record.date_approved;

  return {
    id: String(id),
    status: status.trim().toLowerCase(),
    externalReference:
      typeof record.external_reference === "string" && record.external_reference.length > 0
        ? record.external_reference
        : null,
    preferenceId:
      typeof record.preference_id === "string" && record.preference_id.length > 0
        ? record.preference_id
        : null,
    payerEmail,
    transactionAmount: exactConfirmedMoney(record.transaction_amount),
    currencyId:
      typeof currencyRaw === "string" && currencyRaw.trim().length > 0
        ? currencyRaw.trim().toUpperCase()
        : null,
    dateApproved: typeof approvedRaw === "string" && approvedRaw.trim().length > 0 ? approvedRaw : null,
  };
}

export function parseMercadoPagoCheckoutProPreferenceResponse(
  body: unknown
): MercadoPagoCheckoutProPreferenceMetadata | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const id = record.id;
  if (typeof id !== "string" || id.length === 0) return null;

  const metadata: Record<string, string> = {};
  const rawMetadata = record.metadata;
  if (rawMetadata && typeof rawMetadata === "object") {
    for (const [key, value] of Object.entries(rawMetadata as Record<string, unknown>)) {
      if (typeof value === "string") metadata[key] = value;
    }
  }

  return {
    id,
    externalReference:
      typeof record.external_reference === "string" && record.external_reference.length > 0
        ? record.external_reference
        : null,
    metadata,
  };
}

export function isMercadoPagoCheckoutProPaymentApproved(status: string): boolean {
  return status.trim().toLowerCase() === "approved";
}

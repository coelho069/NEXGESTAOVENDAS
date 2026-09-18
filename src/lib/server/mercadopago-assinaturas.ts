import {
  billingIntervalToMercadoPagoRecurring,
  isMercadoPagoAssinaturasCheckoutEnabledEnv,
  MERCADOPAGO_ASSINATURAS_API_BASE,
  normalizeMercadoPagoAssinaturasAmount,
  parseMercadoPagoAuthorizedPaymentResponse,
  parseMercadoPagoPreapprovalPlanResponse,
  parseMercadoPagoPreapprovalResponse,
  type MercadoPagoAuthorizedPaymentSnapshot,
  type MercadoPagoPreapprovalPlanSnapshot,
  type MercadoPagoPreapprovalSnapshot,
} from "@/lib/domain/mercadopago-assinaturas";
import { verifyMercadoPagoWebhookSignature } from "@/lib/domain/mercadopago-webhook-signature";
import type { SubscriptionBillingInterval } from "@/lib/domain/admin-subscriptions";
import { createLogger } from "@/lib/observability/logger";

/** Logger sem request (gateway roda fora do contexto de rota). correlationId é propagado pelo chamador via contexto de rota. */
const gatewayLogger = createLogger({ service: "nexgestaovendas", component: "mercadopago-assinaturas-gateway" });

/**
 * Log sanitizado do corpo de erro do Mercado Pago.
 * Preserva status HTTP e mensagem/cause; nunca registra Authorization/token/secret/card data.
 */
function logMercadoPagoAssinaturasApiError(
  operation: string,
  status: number,
  body: unknown
): void {
  gatewayLogger.warn("mercadopago_assinaturas_api_error", {
    operation,
    mp_http_status: status,
    mp_error: sanitizeMercadoPagoErrorBody(body),
  });
}

function sanitizeMercadoPagoErrorBody(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const scrub = (value: unknown, depth = 0): unknown => {
    if (depth > 4) return "[truncated]";
    if (Array.isArray(value)) return value.slice(0, 5).map((v) => scrub(v, depth + 1));
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const key = k.toLowerCase();
        if (key.includes("token") || key.includes("secret") || key.includes("authorization") || key.includes("card")) {
          out[k] = "[redacted]";
        } else {
          out[k] = scrub(v, depth + 1);
        }
      }
      return out;
    }
    return value;
  };
  return scrub(body);
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MERCADOPAGO_ASSINATURAS_PAYER_EMAIL = "buyer@testuser.com";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isMercadoPagoAcceptablePayerEmail(value: string): boolean {
  if (!EMAIL_PATTERN.test(value)) return false;
  const domain = value.split("@")[1]?.toLowerCase() ?? "";
  return !domain.endsWith(".local");
}

/** Sandbox requires a valid MP test email; never use .local domains. */
export function resolveMercadoPagoAssinaturasPayerEmail(
  envSource: Record<string, string | undefined> = process.env
): string {
  const candidate =
    envSource.MERCADOPAGO_ASSINATURAS_PAYER_EMAIL?.trim() ||
    envSource.MP_ASSINATURAS_PAYER_EMAIL?.trim() ||
    "";
  if (candidate && isMercadoPagoAcceptablePayerEmail(candidate)) {
    return candidate;
  }
  return DEFAULT_MERCADOPAGO_ASSINATURAS_PAYER_EMAIL;
}

type MercadoPagoAssinaturasEnv =
  | {
      configured: true;
      accessToken: string;
      webhookSecret: string;
      timeoutMs: number;
    }
  | {
      configured: false;
      reason: string;
    };

export function getMercadoPagoAssinaturasEnv(
  envSource: Record<string, string | undefined> = process.env
): MercadoPagoAssinaturasEnv {
  const accessToken =
    envSource.MERCADOPAGO_ASSINATURAS_ACCESS_TOKEN?.trim() ||
    envSource.MP_ASSINATURAS_ACCESS_TOKEN?.trim() ||
    "";
  const webhookSecret =
    envSource.MERCADOPAGO_ASSINATURAS_WEBHOOK_SECRET?.trim() ||
    envSource.MP_ASSINATURAS_WEBHOOK_SECRET?.trim() ||
    "";

  if (!accessToken) {
    return { configured: false, reason: "mercadopago_assinaturas_access_token_missing" };
  }
  if (!webhookSecret) {
    return { configured: false, reason: "mercadopago_assinaturas_webhook_secret_missing" };
  }

  return {
    configured: true,
    accessToken,
    webhookSecret,
    timeoutMs: parseTimeout(
      envSource.MERCADOPAGO_ASSINATURAS_TIMEOUT_MS ?? envSource.MP_ASSINATURAS_TIMEOUT_MS
    ),
  };
}

export function isMercadoPagoAssinaturasCheckoutEnabled(
  envSource: Record<string, string | undefined> = process.env
): boolean {
  return isMercadoPagoAssinaturasCheckoutEnabledEnv(
    envSource.MERCADOPAGO_ASSINATURAS_CHECKOUT_ENABLED
  );
}

const MERCADOPAGO_ASSINATURAS_CHECKOUT_HOLD_MESSAGE =
  "Mercado Pago Assinaturas checkout em hold operacional até opt-in explícito (MERCADOPAGO_ASSINATURAS_CHECKOUT_ENABLED=true).";

export function mercadoPagoAssinaturasCheckoutHoldHealth(): {
  configured: false;
  testmode: false;
  message: string;
  reason: "mercadopago_assinaturas_checkout_hold";
} {
  return {
    configured: false,
    testmode: false,
    message: MERCADOPAGO_ASSINATURAS_CHECKOUT_HOLD_MESSAGE,
    reason: "mercadopago_assinaturas_checkout_hold",
  };
}

export type MercadoPagoAssinaturasGateway = {
  health(): Promise<{ ok: boolean; testmode: boolean; message: string }>;
  createPreapprovalPlan(input: {
    reason: string;
    amount: string;
    billingInterval: SubscriptionBillingInterval;
    backUrl: string;
  }): Promise<MercadoPagoPreapprovalPlanSnapshot>;
  /** Busca um preapproval_plan existente no Mercado Pago (somente leitura). */
  getPreapprovalPlan(planId: string): Promise<MercadoPagoPreapprovalPlanSnapshot | null>;
  /**
   * Cria preapproval via API pura. Exige card_token_id na prática (MP 400 "card_token_id is required")
   * — NÃO usar no checkout público da landing. Mantido para fluxos internos futuros com pagador tokenizado.
   */
  createPreapproval(input: {
    preapprovalPlanId: string;
    reason: string;
    externalReference: string;
    payerEmail: string;
    backUrl: string;
    clientMutationId: string;
  }): Promise<MercadoPagoPreapprovalSnapshot>;
  getPreapproval(preapprovalId: string): Promise<MercadoPagoPreapprovalSnapshot | null>;
  getAuthorizedPayment(
    authorizedPaymentId: string
  ): Promise<MercadoPagoAuthorizedPaymentSnapshot | null>;
};

async function mercadoPagoAssinaturasFetch(
  path: string,
  init: RequestInit & { accessToken: string; timeoutMs: number; idempotencyKey?: string }
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs);
  try {
    return await fetch(`${MERCADOPAGO_ASSINATURAS_API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${init.accessToken}`,
        ...(init.idempotencyKey ? { "X-Idempotency-Key": init.idempotencyKey } : {}),
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function createMercadoPagoAssinaturasGateway(
  env: Extract<MercadoPagoAssinaturasEnv, { configured: true }>
): MercadoPagoAssinaturasGateway {
  return {
    async health() {
      try {
        const response = await mercadoPagoAssinaturasFetch("/users/me", {
          method: "GET",
          accessToken: env.accessToken,
          timeoutMs: env.timeoutMs,
        });
        if (!response.ok) {
          return { ok: false, testmode: true, message: "Mercado Pago Assinaturas health probe failed." };
        }
        return { ok: true, testmode: true, message: "Mercado Pago Assinaturas reachable." };
      } catch {
        return { ok: false, testmode: true, message: "Mercado Pago Assinaturas health probe failed." };
      }
    },
    async createPreapprovalPlan(input) {
      const amount = normalizeMercadoPagoAssinaturasAmount(input.amount);
      const recurring = billingIntervalToMercadoPagoRecurring(input.billingInterval);
      const response = await mercadoPagoAssinaturasFetch("/preapproval_plan", {
        method: "POST",
        accessToken: env.accessToken,
        timeoutMs: env.timeoutMs,
        body: JSON.stringify({
          reason: input.reason,
          auto_recurring: {
            frequency: recurring.frequency,
            frequency_type: recurring.frequency_type,
            transaction_amount: Number(amount),
            currency_id: "BRL",
          },
          back_url: input.backUrl,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        logMercadoPagoAssinaturasApiError("create_preapproval_plan", response.status, body);
        throw new Error("mercadopago_assinaturas_create_plan_failed");
      }
      const snapshot = parseMercadoPagoPreapprovalPlanResponse(body);
      if (!snapshot) {
        logMercadoPagoAssinaturasApiError("create_preapproval_plan_parse", response.status, body);
        throw new Error("mercadopago_assinaturas_create_plan_invalid_response");
      }
      return snapshot;
    },
    async getPreapprovalPlan(planId) {
      const response = await mercadoPagoAssinaturasFetch(
        `/preapproval_plan/${encodeURIComponent(planId)}`,
        {
          method: "GET",
          accessToken: env.accessToken,
          timeoutMs: env.timeoutMs,
        }
      );
      if (response.status === 404) return null;
      const body = await response.json();
      if (!response.ok) {
        logMercadoPagoAssinaturasApiError("get_preapproval_plan", response.status, body);
        throw new Error("mercadopago_assinaturas_get_plan_failed");
      }
      const snapshot = parseMercadoPagoPreapprovalPlanResponse(body);
      if (!snapshot) {
        logMercadoPagoAssinaturasApiError("get_preapproval_plan_parse", response.status, body);
        throw new Error("mercadopago_assinaturas_get_plan_invalid_response");
      }
      return snapshot;
    },
    async createPreapproval(input) {
      const response = await mercadoPagoAssinaturasFetch("/preapproval", {
        method: "POST",
        accessToken: env.accessToken,
        timeoutMs: env.timeoutMs,
        idempotencyKey: input.clientMutationId,
        body: JSON.stringify({
          preapproval_plan_id: input.preapprovalPlanId,
          reason: input.reason,
          external_reference: input.externalReference,
          payer_email: input.payerEmail,
          back_url: input.backUrl,
          status: "pending",
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        logMercadoPagoAssinaturasApiError("create_preapproval", response.status, body);
        throw new Error("mercadopago_assinaturas_create_preapproval_failed");
      }
      const snapshot = parseMercadoPagoPreapprovalResponse(body);
      if (!snapshot) {
        throw new Error("mercadopago_assinaturas_create_preapproval_invalid_response");
      }
      return snapshot;
    },
    async getPreapproval(preapprovalId) {
      const response = await mercadoPagoAssinaturasFetch(
        `/preapproval/${encodeURIComponent(preapprovalId)}`,
        {
          method: "GET",
          accessToken: env.accessToken,
          timeoutMs: env.timeoutMs,
        }
      );
      if (response.status === 404) return null;
      const body = await response.json();
      if (!response.ok) {
        logMercadoPagoAssinaturasApiError("get_preapproval", response.status, body);
        throw new Error("mercadopago_assinaturas_get_preapproval_failed");
      }
      return parseMercadoPagoPreapprovalResponse(body);
    },
    async getAuthorizedPayment(authorizedPaymentId) {
      const response = await mercadoPagoAssinaturasFetch(
        `/authorized_payments/${encodeURIComponent(authorizedPaymentId)}`,
        {
          method: "GET",
          accessToken: env.accessToken,
          timeoutMs: env.timeoutMs,
        }
      );
      if (response.status === 404) return null;
      const body = await response.json();
      if (!response.ok) {
        logMercadoPagoAssinaturasApiError("get_authorized_payment", response.status, body);
        throw new Error("mercadopago_assinaturas_get_authorized_payment_failed");
      }
      return parseMercadoPagoAuthorizedPaymentResponse(body);
    },
  };
}

export function verifyMercadoPagoAssinaturasWebhookRequest(input: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  secret: string;
}): void {
  verifyMercadoPagoWebhookSignature(input);
}

function parseTimeout(raw: string | undefined): number {
  const value = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(value, 1_000), 60_000);
}

export function resolveAssinaturasBackUrl(envSource: Record<string, string | undefined> = process.env): string {
  const origin = envSource.APP_ORIGIN?.trim();
  if (origin) return `${origin.replace(/\/$/, "")}/?checkout=assinaturas`;
  return "http://localhost:3000/?checkout=assinaturas";
}

import {
  bindMercadoPagoPixAdapter,
  getPaymentAdapter,
  type PaymentAdapter,
} from "@/lib/adapters/payment";
import {
  MercadoPagoPixPaymentAdapter,
  type MercadoPagoPixGateway,
} from "@/lib/adapters/mercadopago-pix";
import {
  isMercadoPagoCheckoutEnabledEnv,
  MERCADOPAGO_API_BASE,
  parseMercadoPagoOrderResponse,
  parseMercadoPagoWebhookNotification,
  webhookActionToPaymentState,
  type MercadoPagoWebhookNotification,
} from "@/lib/domain/mercadopago";
import { verifyMercadoPagoWebhookSignature } from "@/lib/domain/mercadopago-webhook-signature";

const HEALTH_TTL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const WEBHOOK_REPLAY_TTL_MS = 24 * 60 * 60 * 1000;

type MercadoPagoEnv =
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

type HealthCache = {
  ok: boolean;
  expiresAt: number;
  message: string;
};

type WebhookReplayEntry = {
  expiresAt: number;
};

let healthCache: HealthCache | null = null;
const processedWebhookEvents = new Map<string, WebhookReplayEntry>();

export function getMercadoPagoEnv(
  envSource: Record<string, string | undefined> = process.env
): MercadoPagoEnv {
  const accessToken =
    envSource.MERCADOPAGO_ACCESS_TOKEN?.trim() || envSource.MP_ACCESS_TOKEN?.trim() || "";
  const webhookSecret =
    envSource.MERCADOPAGO_WEBHOOK_SECRET?.trim() || envSource.MP_WEBHOOK_SECRET?.trim() || "";

  if (!accessToken) {
    return { configured: false, reason: "mercadopago_access_token_missing" };
  }
  if (!webhookSecret) {
    return { configured: false, reason: "mercadopago_webhook_secret_missing" };
  }

  return {
    configured: true,
    accessToken,
    webhookSecret,
    timeoutMs: parseTimeout(envSource.MERCADOPAGO_TIMEOUT_MS ?? envSource.MP_TIMEOUT_MS),
  };
}

export function isMercadoPagoCheckoutEnabled(
  envSource: Record<string, string | undefined> = process.env
): boolean {
  return isMercadoPagoCheckoutEnabledEnv(envSource.MERCADOPAGO_CHECKOUT_ENABLED);
}

const MERCADOPAGO_CHECKOUT_HOLD_MESSAGE =
  "Mercado Pago checkout em hold operacional até opt-in explícito (MERCADOPAGO_CHECKOUT_ENABLED=true).";

export function mercadoPagoCheckoutHoldHealth(): {
  configured: false;
  testmode: false;
  message: string;
  reason: "mercadopago_checkout_hold";
} {
  return {
    configured: false,
    testmode: false,
    message: MERCADOPAGO_CHECKOUT_HOLD_MESSAGE,
    reason: "mercadopago_checkout_hold",
  };
}

async function mercadoPagoFetch(
  path: string,
  init: RequestInit & { accessToken: string; timeoutMs: number }
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs);
  try {
    return await fetch(`${MERCADOPAGO_API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${init.accessToken}`,
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function createMercadoPagoPixGateway(env: Extract<MercadoPagoEnv, { configured: true }>): MercadoPagoPixGateway {
  return {
    async health() {
      try {
        const response = await mercadoPagoFetch("/users/me", {
          method: "GET",
          accessToken: env.accessToken,
          timeoutMs: env.timeoutMs,
        });
        if (!response.ok) {
          return { ok: false, testmode: true, message: "Mercado Pago health probe failed." };
        }
        return { ok: true, testmode: true, message: "Mercado Pago reachable." };
      } catch {
        return { ok: false, testmode: true, message: "Mercado Pago health probe failed." };
      }
    },
    async create(input) {
      const idempotencyKey = input.clientMutationId ?? crypto.randomUUID();
      const response = await mercadoPagoFetch("/v1/orders", {
        method: "POST",
        accessToken: env.accessToken,
        timeoutMs: env.timeoutMs,
        headers: {
          "X-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          type: "online",
          total_amount: input.amount,
          external_reference: input.clientMutationId ?? idempotencyKey,
          processing_mode: "automatic",
          transactions: {
            payments: [
              {
                amount: input.amount,
                payment_method: {
                  id: "pix",
                  type: "bank_transfer",
                },
              },
            ],
          },
          payer: {
            email: "pdv@nexgestaovendas.local",
          },
          metadata: {
            store_id: input.storeId ?? "",
            client_mutation_id: input.clientMutationId ?? "",
            app: "nex-gestaovendas",
            rail: "mercadopago-pix",
          },
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error("mercadopago_create_order_failed");
      }
      const snapshot = parseMercadoPagoOrderResponse(body);
      if (!snapshot) {
        throw new Error("mercadopago_create_order_invalid_response");
      }
      return snapshot;
    },
    async cancel(input) {
      const response = await mercadoPagoFetch(`/v1/orders/${encodeURIComponent(input.providerReference)}/cancel`, {
        method: "POST",
        accessToken: env.accessToken,
        timeoutMs: env.timeoutMs,
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error("mercadopago_cancel_order_failed");
      }
      const snapshot = parseMercadoPagoOrderResponse(body);
      if (!snapshot) {
        throw new Error("mercadopago_cancel_order_invalid_response");
      }
      return snapshot;
    },
    async retrieve(input) {
      const response = await mercadoPagoFetch(`/v1/orders/${encodeURIComponent(input.providerReference)}`, {
        method: "GET",
        accessToken: env.accessToken,
        timeoutMs: env.timeoutMs,
      });
      if (response.status === 404) return null;
      const body = await response.json();
      if (!response.ok) {
        throw new Error("mercadopago_get_order_failed");
      }
      return parseMercadoPagoOrderResponse(body);
    },
  };
}

export async function probeMercadoPagoPixHealth(force = false): Promise<{
  ok: boolean;
  configured: boolean;
  testmode: boolean;
  message: string;
  reason?: string;
}> {
  if (!isMercadoPagoCheckoutEnabled()) {
    bindMercadoPagoPixAdapter(null);
    return {
      ok: false,
      configured: false,
      testmode: false,
      message: MERCADOPAGO_CHECKOUT_HOLD_MESSAGE,
      reason: "mercadopago_checkout_hold",
    };
  }

  const env = getMercadoPagoEnv();
  if (!env.configured) {
    bindMercadoPagoPixAdapter(null);
    return {
      ok: false,
      configured: false,
      testmode: false,
      message: "Mercado Pago PIX adapter not_configured.",
      reason: env.reason,
    };
  }

  const now = Date.now();
  if (!force && healthCache && healthCache.expiresAt > now) {
    if (healthCache.ok) {
      bindMercadoPagoPixAdapter(createBoundAdapter(env));
    } else {
      bindMercadoPagoPixAdapter(null);
    }
    return {
      ok: healthCache.ok,
      configured: healthCache.ok,
      testmode: true,
      message: healthCache.message,
      reason: healthCache.ok ? undefined : "mercadopago_health_failed",
    };
  }

  const health = await createMercadoPagoPixGateway(env).health();
  healthCache = {
    ok: health.ok,
    expiresAt: now + HEALTH_TTL_MS,
    message: health.message,
  };

  if (health.ok) {
    bindMercadoPagoPixAdapter(createBoundAdapter(env));
  } else {
    bindMercadoPagoPixAdapter(null);
  }

  return {
    ok: health.ok,
    configured: health.ok,
    testmode: true,
    message: health.message,
    reason: health.ok ? undefined : "mercadopago_health_failed",
  };
}

export async function resolveMercadoPagoPixPaymentAdapter(): Promise<PaymentAdapter> {
  await probeMercadoPagoPixHealth();
  return getPaymentAdapter("pix");
}

export function resetMercadoPagoHealthCache(): void {
  healthCache = null;
  bindMercadoPagoPixAdapter(null);
  processedWebhookEvents.clear();
}

export function resetMercadoPagoWebhookReplayCache(): void {
  processedWebhookEvents.clear();
}

function createBoundAdapter(env: Extract<MercadoPagoEnv, { configured: true }>): PaymentAdapter {
  return new MercadoPagoPixPaymentAdapter(createMercadoPagoPixGateway(env));
}

export function verifyMercadoPagoWebhookRequest(input: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  secret: string;
}): void {
  verifyMercadoPagoWebhookSignature(input);
}

function purgeExpiredWebhookEvents(now: number): void {
  for (const [key, entry] of processedWebhookEvents.entries()) {
    if (entry.expiresAt <= now) {
      processedWebhookEvents.delete(key);
    }
  }
}

function markWebhookProcessed(eventKey: string, now: number): boolean {
  purgeExpiredWebhookEvents(now);
  const existing = processedWebhookEvents.get(eventKey);
  if (existing && existing.expiresAt > now) {
    return true;
  }
  processedWebhookEvents.set(eventKey, { expiresAt: now + WEBHOOK_REPLAY_TTL_MS });
  return false;
}

export type MercadoPagoWebhookApplyResult = {
  status: string;
  providerReference?: string;
  replay?: boolean;
  ignored?: boolean;
};

export function applyMercadoPagoWebhookNotification(
  notification: MercadoPagoWebhookNotification
): MercadoPagoWebhookApplyResult {
  const now = Date.now();
  const eventKey = String(notification.id);
  const replay = markWebhookProcessed(eventKey, now);
  if (replay) {
    return {
      status: "replay",
      providerReference: notification.data.id,
      replay: true,
    };
  }

  const mapped = webhookActionToPaymentState(notification.action);
  if (mapped === "ignored") {
    return {
      status: "ignored",
      providerReference: notification.data.id,
      ignored: true,
    };
  }

  return {
    status: mapped,
    providerReference: notification.data.id,
  };
}

export function parseMercadoPagoWebhookBody(body: unknown): MercadoPagoWebhookNotification | null {
  return parseMercadoPagoWebhookNotification(body);
}

function parseTimeout(raw: string | undefined): number {
  const value = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(value, 1_000), 60_000);
}

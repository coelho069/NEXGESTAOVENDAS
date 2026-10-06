import {
  getMercadoPagoEnv,
  isMercadoPagoCheckoutEnabled,
} from "@/lib/server/mercadopago";
import { createPublicCheckoutSession } from "@/lib/server/public-checkout-sessions";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildMercadoPagoBackUrls,
  MERCADOPAGO_CHECKOUT_PRO_API_BASE,
  normalizeCheckoutProAmount,
  parseMercadoPagoCheckoutProPaymentResponse,
  parseMercadoPagoCheckoutProPreferenceResponse,
  parseMercadoPagoPreferenceResponse,
  resolveCheckoutProAppOrigin,
  type MercadoPagoCheckoutProPaymentSnapshot,
  type MercadoPagoCheckoutProPreferenceMetadata,
} from "@/lib/domain/mercadopago-checkout-pro";
import { buildMercadoPagoNotificationUrl } from "@/lib/domain/mercadopago-payment-ipn";
import { createLogger } from "@/lib/observability/logger";

const logger = createLogger({ service: "nexgestaovendas", component: "mercadopago-checkout-pro" });

export type CheckoutProResult =
  | {
      ok: true;
      init_point: string;
      sandbox_init_point: string | null;
      preference_id: string;
      client_mutation_id: string;
      replayed: boolean;
    }
  | { ok: false; error: string; status: number };

const DEFAULT_TIMEOUT_MS = 15_000;

async function checkoutProFetch(
  path: string,
  init: RequestInit & { accessToken: string; timeoutMs: number }
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs);
  try {
    return await fetch(`${MERCADOPAGO_CHECKOUT_PRO_API_BASE}${path}`, {
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

/**
 * Cria uma Checkout Pro Preference (pagamento único / PIX) e devolve o
 * init_point (produção) ou sandbox_init_point (sandbox) para redirecionar o
 * visitante. Não faz cobrança real aqui: o MP coleta o pagamento no checkout.
 */
export async function executeCheckoutProPreference(input: {
  planId: string;
  planName: string;
  amount: string;
  payerEmail: string;
  clientMutationId: string;
  correlationId?: string;
  envSource?: Record<string, string | undefined>;
}): Promise<CheckoutProResult> {
  const envSource = input.envSource ?? process.env;

  if (!isMercadoPagoCheckoutEnabled(envSource)) {
    return { ok: false, error: "mercadopago_checkout_hold", status: 503 };
  }

  const env = getMercadoPagoEnv(envSource);
  if (!env.configured) {
    return { ok: false, error: env.reason, status: 503 };
  }

  // Ancore a sessão pública de onboarding (mesma tabela usada pelo rail Stripe).
  const admin = createAdminClient();
  if (!admin) {
    return { ok: false, error: "service_role_unavailable", status: 503 };
  }
  const session = await createPublicCheckoutSession({
    admin,
    planId: input.planId,
    payerEmail: input.payerEmail,
    clientMutationId: input.clientMutationId,
    correlationId: input.correlationId,
  });
  if (!session.ok) {
    return { ok: false, error: session.error, status: session.status };
  }

  const amount = normalizeCheckoutProAmount(input.amount);
  const origin = resolveCheckoutProAppOrigin(envSource);
  const backUrls = buildMercadoPagoBackUrls(origin);

  try {
    const response = await checkoutProFetch("/checkout/preferences", {
      method: "POST",
      accessToken: env.accessToken,
      timeoutMs: env.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      headers: {
        "X-Idempotency-Key": input.clientMutationId,
      },
      body: JSON.stringify({
        items: [
          {
            id: input.planId,
            title: input.planName,
            quantity: 1,
            currency_id: "BRL",
            unit_price: Number(amount),
          },
        ],
        payer: {
          email: input.payerEmail,
        },
        external_reference: input.clientMutationId,
        notification_url: buildMercadoPagoNotificationUrl(origin),
        back_urls: {
          success: backUrls.success,
          failure: backUrls.failure,
          pending: backUrls.pending,
        },
        auto_return: "approved",
      }),
    });

    const body = await response.json();
    if (!response.ok) {
      logger.warn("mercadopago_checkout_pro_create_failed", {
        correlationId: input.correlationId,
        mp_http_status: response.status,
      });
      return { ok: false, error: "mercadopago_checkout_pro_failed", status: 502 };
    }

    const snapshot = parseMercadoPagoPreferenceResponse(body);
    if (!snapshot) {
      return { ok: false, error: "mercadopago_checkout_pro_invalid_response", status: 502 };
    }

    // Produção: preferir init_point (live). Só usar sandbox_init_point quando
    // a API não devolver init_point (conta/credencial de sandbox).
    const initPoint = snapshot.initPoint ?? snapshot.sandboxInitPoint;
    if (!initPoint) {
      return { ok: false, error: "mercadopago_checkout_pro_missing_init_point", status: 502 };
    }

    return {
      ok: true,
      init_point: initPoint,
      sandbox_init_point: snapshot.sandboxInitPoint,
      preference_id: snapshot.id,
      client_mutation_id: input.clientMutationId,
      replayed: session.replayed,
    };
  } catch {
    logger.warn("mercadopago_checkout_pro_create_error", {
      correlationId: input.correlationId,
    });
    return { ok: false, error: "mercadopago_checkout_pro_failed", status: 502 };
  }
}

export type MercadoPagoCheckoutProGateway = {
  getPayment(paymentId: string): Promise<MercadoPagoCheckoutProPaymentSnapshot | null>;
  getPreference(preferenceId: string): Promise<MercadoPagoCheckoutProPreferenceMetadata | null>;
};

export function createMercadoPagoCheckoutProGateway(input: {
  accessToken: string;
  timeoutMs?: number;
}): MercadoPagoCheckoutProGateway {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async getPayment(paymentId) {
      const response = await checkoutProFetch(
        `/v1/payments/${encodeURIComponent(paymentId.trim())}`,
        {
          method: "GET",
          accessToken: input.accessToken,
          timeoutMs,
        }
      );
      if (response.status === 404) return null;
      const body = await response.json();
      if (!response.ok) {
        throw new Error("mercadopago_checkout_pro_get_payment_failed");
      }
      return parseMercadoPagoCheckoutProPaymentResponse(body);
    },
    async getPreference(preferenceId) {
      const response = await checkoutProFetch(
        `/checkout/preferences/${encodeURIComponent(preferenceId.trim())}`,
        {
          method: "GET",
          accessToken: input.accessToken,
          timeoutMs,
        }
      );
      if (response.status === 404) return null;
      const body = await response.json();
      if (!response.ok) {
        throw new Error("mercadopago_checkout_pro_get_preference_failed");
      }
      return parseMercadoPagoCheckoutProPreferenceResponse(body);
    },
  };
}

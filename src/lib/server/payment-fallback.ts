import Stripe from "stripe";
import { createStripeClient, getStripeCardEnv } from "@/lib/server/stripe-card";
import { getMercadoPagoEnv, isMercadoPagoCheckoutEnabled, createMercadoPagoPixGateway } from "@/lib/server/mercadopago";
import { stripeAmountFromBrl, STRIPE_CARD_CURRENCY } from "@/lib/domain/stripe-card";
import {
  isPixUnavailableError,
  NO_PAYMENT_PROVIDER,
  PIX_NOT_ENABLED_ON_ACCOUNT,
  STRIPE_ERROR,
  type CreatePaymentResult,
} from "@/lib/domain/payment-fallback";
import { rootLogger } from "@/lib/observability/logger";

const fallbackLog = rootLogger.child({ component: "payment-fallback" });

export type CreatePaymentWithFallbackInput = {
  /** BRL amount string, e.g. "10.00". */
  amount: string;
  clientMutationId?: string;
  storeId?: string;
  envSource?: Record<string, string | undefined>;
};

type StripeCodeAndType = { code?: string; type?: string; decline_code?: string; param?: string };

/**
 * `payment_method_types: ['pix']` primeira tentativa (BRL). Se a conta Stripe
 * não tiver PIX ativo, a SDK recusa e caímos no fallback automático:
 *
 *   a) Stripe card (`payment_method_types: ['card']`)
 *   b) Mercado Pago (se `MP_ACCESS_TOKEN`/`MERCADOPAGO_ACCESS_TOKEN` existir)
 *   c) erro controlado `NO_PAYMENT_PROVIDER` — nunca tela branca / 500
 *
 * Sempre retorna o mesmo JSON estável (`CreatePaymentResult`). Loga apenas o
 * code + type do erro Stripe, sem secret e sem payload de cartão.
 */
export async function createPaymentWithFallback(
  input: CreatePaymentWithFallbackInput
): Promise<CreatePaymentResult> {
  const env = input.envSource ?? process.env;
  const pixEnabled = env.STRIPE_PIX_ENABLED === "true";
  const cardEnv = getStripeCardEnv(env);

  if (!pixEnabled) {
    // Feature flag off: nem tente PIX, vá direto ao fallback de cartão.
    const stripe = cardEnv.configured
      ? createStripeClient(cardEnv.secretKey, cardEnv.timeoutMs)
      : null;
    return runCardFallback(input, stripe);
  }

  if (!cardEnv.configured) {
    fallbackLog.warn("pix_create_stripe_not_configured", { reason: cardEnv.reason });
    return controlledNoProvider("PIX indisponível e Stripe não configurado para fallback.");
  }

  const stripe = createStripeClient(cardEnv.secretKey, cardEnv.timeoutMs);

  // 1) Tentativa principal: PaymentIntent PIX (BRL).
  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: stripeAmountFromBrl(input.amount),
        currency: STRIPE_CARD_CURRENCY,
        payment_method_types: ["pix"],
        confirm: true,
        payment_method_data: { type: "pix" },
        metadata: {
          store_id: input.storeId ?? "",
          client_mutation_id: input.clientMutationId ?? "",
          app: "nex-gestaovendas",
          rail: "pix",
        },
      },
      input.clientMutationId
        ? { idempotencyKey: `pix-create:${input.clientMutationId}` }
        : undefined
    );

    return {
      ok: true,
      provider: "stripe",
      method: "pix",
      fallback: false,
      code: null,
      client_secret: intent.client_secret,
      message: "QR PIX gerado. Venda não confirmada até PaymentIntent succeeded.",
    };
  } catch (error) {
    const stripeError = stripeCodeAndType(error);

    if (isPixUnavailableError(error)) {
      fallbackLog.warn("stripe_pix_not_enabled_on_account", {
        code: stripeError.code ?? "unknown",
        type: stripeError.type ?? stripeError.decline_code ?? "unknown",
        param: stripeError.param,
      });
      return runCardFallback(input, stripe);
    }

    fallbackLog.error("stripe_pix_create_error", {
      code: stripeError.code ?? "unknown",
      type: stripeError.type ?? stripeError.decline_code ?? "unknown",
      param: stripeError.param,
    });
    return {
      ok: false,
      provider: "stripe",
      method: "pix",
      fallback: false,
      code: STRIPE_ERROR,
      client_secret: null,
      message: "Stripe recusou o PIX. Tente novamente ou use outro meio de pagamento.",
    };
  }
}

/** Stripe card fallback: `payment_method_types: ['card']`, autorização manual. */
async function runCardFallback(
  input: CreatePaymentWithFallbackInput,
  stripe: Stripe | null
): Promise<CreatePaymentResult> {
  const env = input.envSource ?? process.env;
  const cardEnv = getStripeCardEnv(env);

  if (stripe && cardEnv.configured) {
    try {
      const intent = await stripe.paymentIntents.create(
        {
          amount: stripeAmountFromBrl(input.amount),
          currency: STRIPE_CARD_CURRENCY,
          capture_method: "manual",
          payment_method_types: ["card"],
          metadata: {
            store_id: input.storeId ?? "",
            client_mutation_id: input.clientMutationId ?? "",
            app: "nex-gestaovendas",
            rail: "card",
          },
        },
        input.clientMutationId
          ? { idempotencyKey: `card-fallback:${input.clientMutationId}` }
          : undefined
      );

      return {
        ok: true,
        provider: "stripe",
        method: "card",
        fallback: true,
        code: PIX_NOT_ENABLED_ON_ACCOUNT,
        client_secret: intent.client_secret,
        message: "PIX ainda não está ativo nesta conta Stripe. Pagamento seguirá com cartão.",
      };
    } catch (error) {
      const stripeError = stripeCodeAndType(error);
      fallbackLog.error("stripe_card_fallback_error", {
        code: stripeError.code ?? "unknown",
        type: stripeError.type ?? stripeError.decline_code ?? "unknown",
      });
      // Cartão falhou → tenta Mercado Pago (b), se existir.
      return runMercadoPagoFallback(input);
    }
  }

  return runMercadoPagoFallback(input);
}

/** Mercado Pago fallback (b): apenas se o access token existir e o checkout estiver ligado. */
async function runMercadoPagoFallback(input: CreatePaymentWithFallbackInput): Promise<CreatePaymentResult> {
  const env = input.envSource ?? process.env;
  const mpEnv = getMercadoPagoEnv(env);

  if (!mpEnv.configured) {
    fallbackLog.warn("payment_fallback_no_mercadopago", { reason: mpEnv.reason });
    return controlledNoProvider("Nenhum provedor de pagamento disponível. Escolha outro meio de pagamento.");
  }

  if (!isMercadoPagoCheckoutEnabled(env)) {
    return controlledNoProvider("Mercado Pago não habilitado. Escolha outro meio de pagamento.");
  }

  try {
    const gateway = createMercadoPagoPixGateway(mpEnv);
    await gateway.create({
      amount: input.amount,
      clientMutationId: input.clientMutationId,
      storeId: input.storeId,
    });

    return {
      ok: true,
      provider: "mercadopago",
      method: "pix",
      fallback: true,
      code: PIX_NOT_ENABLED_ON_ACCOUNT,
      client_secret: null,
      message: "PIX via Mercado Pago. Venda não confirmada até a ordem processar.",
    };
  } catch (error) {
    fallbackLog.error("mercadopago_fallback_error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return controlledNoProvider("Mercado Pago indisponível no momento. Escolha outro meio de pagamento.");
  }
}

/** (c) Resposta controlada pedindo outro meio — nunca 500/tela branca. */
function controlledNoProvider(message: string): CreatePaymentResult {
  return {
    ok: false,
    provider: null,
    method: "other",
    fallback: true,
    code: NO_PAYMENT_PROVIDER,
    client_secret: null,
    message,
  };
}

/** Extrai apenas code/type/decline_code/param de um erro Stripe (sem secret/payload). */
function stripeCodeAndType(error: unknown): StripeCodeAndType {
  if (!error || typeof error !== "object") return {};
  const candidate = error as StripeCodeAndType;
  return {
    code: typeof candidate.code === "string" ? candidate.code : undefined,
    type: typeof candidate.type === "string" ? candidate.type : undefined,
    decline_code: typeof candidate.decline_code === "string" ? candidate.decline_code : undefined,
    param: typeof candidate.param === "string" ? candidate.param : undefined,
  };
}

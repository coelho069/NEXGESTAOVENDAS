import Stripe from "stripe";
import {
  bindStripePixAdapter,
  getPaymentAdapter,
  type PaymentAdapter,
} from "@/lib/adapters/payment";
import { StripePixPaymentAdapter, type StripePixGateway } from "@/lib/adapters/stripe-pix";
import { extractPixQr, type StripePixIntentSnapshot } from "@/lib/domain/stripe-pix";
import { stripeAmountFromBrl, STRIPE_CARD_CURRENCY } from "@/lib/domain/stripe-card";
import { createStripeClient, getStripeCardEnv } from "@/lib/server/stripe-card";

const HEALTH_TTL_MS = 30_000;

type HealthCache = {
  ok: boolean;
  expiresAt: number;
  message: string;
};

let healthCache: HealthCache | null = null;

export function createStripePixGateway(stripe: Stripe): StripePixGateway {
  return {
    async health() {
      try {
        await stripe.balance.retrieve();
        return { ok: true, testmode: true, message: "Stripe testmode reachable." };
      } catch {
        return { ok: false, testmode: true, message: "Stripe health probe failed." };
      }
    },
    async create(input) {
      const intent = await stripe.paymentIntents.create(
        {
          amount: stripeAmountFromBrl(input.amount),
          currency: STRIPE_CARD_CURRENCY,
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
      return toPixSnapshot(intent);
    },
    async cancel(input) {
      const intent = await stripe.paymentIntents.cancel(input.providerReference);
      return toPixSnapshot(intent);
    },
    async retrieve(input) {
      const intent = await stripe.paymentIntents.retrieve(input.providerReference);
      return toPixSnapshot(intent);
    },
  };
}

export async function probeStripePixHealth(force = false): Promise<{
  ok: boolean;
  configured: boolean;
  testmode: boolean;
  message: string;
  reason?: string;
}> {
  const env = getStripeCardEnv();
  if (!env.configured) {
    bindStripePixAdapter(null);
    return {
      ok: false,
      configured: false,
      testmode: false,
      message: "Stripe PIX adapter not_configured.",
      reason: env.reason,
    };
  }

  const now = Date.now();
  if (!force && healthCache && healthCache.expiresAt > now) {
    if (healthCache.ok) {
      bindStripePixAdapter(createBoundAdapter(env));
    } else {
      bindStripePixAdapter(null);
    }
    return {
      ok: healthCache.ok,
      configured: healthCache.ok,
      testmode: true,
      message: healthCache.message,
    };
  }

  const stripe = createStripeClient(env.secretKey, env.timeoutMs);
  const health = await createStripePixGateway(stripe).health();
  healthCache = {
    ok: health.ok,
    expiresAt: now + HEALTH_TTL_MS,
    message: health.message,
  };

  if (health.ok) {
    bindStripePixAdapter(createBoundAdapter(env, stripe));
  } else {
    bindStripePixAdapter(null);
  }

  return {
    ok: health.ok,
    configured: health.ok,
    testmode: true,
    message: health.message,
    reason: health.ok ? undefined : "stripe_health_failed",
  };
}

export async function resolvePixPaymentAdapter(): Promise<PaymentAdapter> {
  await probeStripePixHealth();
  return getPaymentAdapter("pix");
}

export function resetStripePixHealthCache(): void {
  healthCache = null;
  bindStripePixAdapter(null);
}

function createBoundAdapter(
  env: Extract<ReturnType<typeof getStripeCardEnv>, { configured: true }>,
  stripe?: Stripe
): PaymentAdapter {
  const client = stripe ?? createStripeClient(env.secretKey, env.timeoutMs);
  return new StripePixPaymentAdapter(createStripePixGateway(client));
}

function toPixSnapshot(intent: Stripe.PaymentIntent): StripePixIntentSnapshot {
  const types = Array.isArray(intent.payment_method_types) ? intent.payment_method_types : [];
  return {
    id: intent.id,
    status: intent.status,
    amount: intent.amount,
    currency: intent.currency,
    livemode: intent.livemode,
    received: true,
    qr: extractPixQr(intent.next_action),
    paymentMethodTypes: types,
  };
}

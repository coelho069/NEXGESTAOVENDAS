import Stripe from "stripe";
import {
  bindStripeCardAdapter,
  getPaymentAdapter,
  type PaymentAdapter,
} from "@/lib/adapters/payment";
import { StripeCardPaymentAdapter, type StripeCardGateway } from "@/lib/adapters/stripe-card";
import {
  isStripeTestSecret,
  stripeAmountFromBrl,
  STRIPE_CARD_CURRENCY,
  STRIPE_TEST_PAYMENT_METHOD,
  type StripeCardIntentSnapshot,
} from "@/lib/domain/stripe-card";

const HEALTH_TTL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 15_000;

type StripeCardEnv =
  | {
      configured: true;
      secretKey: string;
      webhookSecret: string;
      testmode: true;
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

let healthCache: HealthCache | null = null;

export function getStripeCardEnv(
  envSource: Record<string, string | undefined> = process.env
): StripeCardEnv {
  const secretKey = envSource.STRIPE_SECRET_KEY?.trim() ?? "";
  const webhookSecret = envSource.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  if (!secretKey) {
    return { configured: false, reason: "stripe_secret_missing" };
  }
  if (!isStripeTestSecret(secretKey)) {
    return { configured: false, reason: "stripe_livemode_unsupported" };
  }
  if (!webhookSecret) {
    return { configured: false, reason: "stripe_webhook_secret_missing" };
  }
  return {
    configured: true,
    secretKey,
    webhookSecret,
    testmode: true,
    timeoutMs: parseTimeout(envSource.STRIPE_TIMEOUT_MS),
  };
}

export function createStripeClient(secretKey: string, timeoutMs = DEFAULT_TIMEOUT_MS): Stripe {
  return new Stripe(secretKey, {
    timeout: timeoutMs,
    maxNetworkRetries: 0,
    typescript: true,
  });
}

export function createStripeCardGateway(
  stripe: Stripe,
  options: { testPaymentMethod?: string } = {}
): StripeCardGateway {
  const paymentMethod = options.testPaymentMethod ?? STRIPE_TEST_PAYMENT_METHOD;

  return {
    async health() {
      try {
        await stripe.balance.retrieve();
        return { ok: true, testmode: true, message: "Stripe testmode reachable." };
      } catch {
        return { ok: false, testmode: true, message: "Stripe health probe failed." };
      }
    },
    async authorize(input) {
      const intent = await stripe.paymentIntents.create(
        {
          amount: stripeAmountFromBrl(input.amount),
          currency: STRIPE_CARD_CURRENCY,
          capture_method: "manual",
          confirm: true,
          payment_method: paymentMethod,
          automatic_payment_methods: { enabled: true, allow_redirects: "never" },
          metadata: {
            store_id: input.storeId ?? "",
            client_mutation_id: input.clientMutationId ?? "",
            app: "nex-gestaovendas",
          },
        },
        input.clientMutationId
          ? { idempotencyKey: `card-authorize:${input.clientMutationId}` }
          : undefined
      );
      return toSnapshot(intent);
    },
    async capture(input) {
      const intent = await stripe.paymentIntents.capture(input.providerReference, {
        amount_to_capture: stripeAmountFromBrl(input.amount),
      });
      return toSnapshot(intent);
    },
    async cancel(input) {
      const intent = await stripe.paymentIntents.cancel(input.providerReference);
      return toSnapshot(intent);
    },
    async retrieve(input) {
      const intent = await stripe.paymentIntents.retrieve(input.providerReference);
      return toSnapshot(intent);
    },
  };
}

export async function probeStripeCardHealth(force = false): Promise<{
  ok: boolean;
  configured: boolean;
  testmode: boolean;
  message: string;
  reason?: string;
}> {
  const env = getStripeCardEnv();
  if (!env.configured) {
    bindStripeCardAdapter(null);
    return {
      ok: false,
      configured: false,
      testmode: false,
      message: "Stripe card adapter not_configured.",
      reason: env.reason,
    };
  }

  const now = Date.now();
  if (!force && healthCache && healthCache.expiresAt > now) {
    if (healthCache.ok) {
      bindStripeCardAdapter(createBoundAdapter(env));
    } else {
      bindStripeCardAdapter(null);
    }
    return {
      ok: healthCache.ok,
      configured: healthCache.ok,
      testmode: true,
      message: healthCache.message,
    };
  }

  const stripe = createStripeClient(env.secretKey, env.timeoutMs);
  const health = await createStripeCardGateway(stripe).health();
  healthCache = {
    ok: health.ok,
    expiresAt: now + HEALTH_TTL_MS,
    message: health.message,
  };

  if (health.ok) {
    bindStripeCardAdapter(createBoundAdapter(env, stripe));
  } else {
    bindStripeCardAdapter(null);
  }

  return {
    ok: health.ok,
    configured: health.ok,
    testmode: true,
    message: health.message,
    reason: health.ok ? undefined : "stripe_health_failed",
  };
}

export async function resolveCardPaymentAdapter(): Promise<PaymentAdapter> {
  const health = await probeStripeCardHealth();
  if (!health.configured) {
    return getPaymentAdapter("card");
  }
  return getPaymentAdapter("card");
}

export function resetStripeCardHealthCache(): void {
  healthCache = null;
  bindStripeCardAdapter(null);
}

export function verifyStripeWebhookSignature(input: {
  payload: string;
  signature: string | null;
  secret: string;
}): Stripe.Event {
  if (!input.signature) {
    throw new Error("stripe_webhook_unsigned");
  }
  return Stripe.webhooks.constructEvent(input.payload, input.signature, input.secret);
}

function createBoundAdapter(env: Extract<StripeCardEnv, { configured: true }>, stripe?: Stripe): PaymentAdapter {
  const client = stripe ?? createStripeClient(env.secretKey, env.timeoutMs);
  return new StripeCardPaymentAdapter(createStripeCardGateway(client));
}

function toSnapshot(intent: Stripe.PaymentIntent): StripeCardIntentSnapshot {
  return {
    id: intent.id,
    status: intent.status,
    amount: intent.amount,
    currency: intent.currency,
    livemode: intent.livemode,
    received: true,
  };
}

function parseTimeout(raw: string | undefined): number {
  const value = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(value, 1_000), 60_000);
}

import { money, toMoneyString } from "@/lib/money";
import type { PaymentState } from "@/lib/domain/payment-state";

export const STRIPE_CARD_CURRENCY = "brl" as const;
export const STRIPE_TEST_PAYMENT_METHOD = "pm_card_visa";

export const STRIPE_WEBHOOK_EVENT_ALLOWLIST = [
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "refund.failed",
] as const;

export type StripeWebhookEventType = (typeof STRIPE_WEBHOOK_EVENT_ALLOWLIST)[number];

export type StripeIntentOperation = "authorize" | "capture" | "cancel" | "reconcile";

export type StripeCardIntentSnapshot = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  livemode: boolean;
  received: boolean;
};

export type StripeReconcileDecision = {
  status: PaymentState;
  message: string;
  providerReference?: string;
  mismatch: boolean;
};

const TEST_SECRET_PREFIXES = ["sk_test_", "rk_test_"] as const;

export function isStripeTestSecret(secret: string): boolean {
  return TEST_SECRET_PREFIXES.some((prefix) => secret.startsWith(prefix));
}

export function isStripeWebhookEventAllowed(type: string): type is StripeWebhookEventType {
  return (STRIPE_WEBHOOK_EVENT_ALLOWLIST as readonly string[]).includes(type);
}

export function stripeAmountFromBrl(amount: string): number {
  const cents = money(amount).mul(100);
  if (!cents.isInteger() || cents.lte(0) || cents.gt("999999999999")) {
    throw new Error("invalid_card_amount");
  }
  return cents.toNumber();
}

export function brlFromStripeAmount(cents: number): string {
  return toMoneyString(money(cents).div(100));
}

export function amountsMatchBrl(localAmount: string, stripeCents: number, currency: string): boolean {
  if (currency.toLowerCase() !== STRIPE_CARD_CURRENCY) return false;
  try {
    return stripeAmountFromBrl(localAmount) === stripeCents;
  } catch {
    return false;
  }
}

export function mapStripeIntentStatus(
  stripeStatus: string,
  operation: StripeIntentOperation
): PaymentState {
  switch (stripeStatus) {
    case "requires_capture":
      return "authorized";
    case "succeeded":
      return operation === "authorize" ? "authorized" : "captured";
    case "canceled":
      return "cancelled";
    case "requires_payment_method":
    case "requires_confirmation":
    case "requires_action":
      return operation === "authorize" ? "pending" : "unknown";
    case "processing":
      return "unknown";
    default:
      return "unknown";
  }
}

export function classifySilentHttpSuccess(
  httpOk: boolean,
  snapshot: StripeCardIntentSnapshot | null,
  operation: StripeIntentOperation
): PaymentState | null {
  if (!httpOk) return "unknown";
  if (!snapshot?.received || !snapshot.id || !snapshot.status) {
    return "unknown";
  }
  if (operation === "capture" && snapshot.status !== "succeeded") {
    return "unknown";
  }
  return null;
}

export function reconcileStripePaymentIntent(input: {
  expectedProviderRef: string;
  expectedAmount: string;
  expectedCurrency?: string;
  snapshot: StripeCardIntentSnapshot | null;
}): StripeReconcileDecision {
  const expectedCurrency = (input.expectedCurrency ?? STRIPE_CARD_CURRENCY).toLowerCase();
  if (!input.snapshot || !input.snapshot.received || !input.snapshot.id) {
    return {
      status: "unknown",
      message: "PaymentIntent ausente ou sem resposta confirmada.",
      mismatch: true,
    };
  }

  if (input.snapshot.id !== input.expectedProviderRef) {
    return {
      status: "unknown",
      message: "provider_ref não corresponde ao PaymentIntent.id.",
      providerReference: input.snapshot.id,
      mismatch: true,
    };
  }

  if (
    !amountsMatchBrl(input.expectedAmount, input.snapshot.amount, input.snapshot.currency) ||
    input.snapshot.currency.toLowerCase() !== expectedCurrency
  ) {
    return {
      status: "unknown",
      message: "Valor ou moeda do PaymentIntent não conferem com o pagamento local.",
      providerReference: input.snapshot.id,
      mismatch: true,
    };
  }

  if (input.snapshot.status === "succeeded") {
    return {
      status: "captured",
      message: "PaymentIntent succeeded e conferido.",
      providerReference: input.snapshot.id,
      mismatch: false,
    };
  }

  if (input.snapshot.status === "canceled") {
    return {
      status: "cancelled",
      message: "PaymentIntent cancelado no provedor.",
      providerReference: input.snapshot.id,
      mismatch: false,
    };
  }

  if (input.snapshot.status === "requires_payment_method") {
    return {
      status: "failed",
      message: "PaymentIntent falhou no provedor.",
      providerReference: input.snapshot.id,
      mismatch: false,
    };
  }

  if (input.snapshot.status === "requires_capture") {
    return {
      status: "authorized",
      message: "PaymentIntent autorizado; captura ainda não confirmada.",
      providerReference: input.snapshot.id,
      mismatch: false,
    };
  }

  return {
    status: "unknown",
    message: "PaymentIntent sem succeeded; pagamento local permanece unknown.",
    providerReference: input.snapshot.id,
    mismatch: true,
  };
}

export function webhookEventToPaymentState(type: StripeWebhookEventType): PaymentState | "pending_external" {
  switch (type) {
    case "payment_intent.succeeded":
      return "captured";
    case "payment_intent.payment_failed":
      return "failed";
    case "payment_intent.canceled":
      return "cancelled";
    case "charge.refunded":
    case "refund.created":
    case "refund.updated":
    case "refund.failed":
      return "pending_external";
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

export function cardRefundStatusPendingExternal(): "pending_external" {
  return "pending_external";
}

export function mustNotInventRefundCash(method: string): boolean {
  return method === "card" || method === "pix" || method === "voucher" || method === "other";
}

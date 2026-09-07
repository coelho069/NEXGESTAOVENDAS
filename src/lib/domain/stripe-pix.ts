import type { PaymentState } from "@/lib/domain/payment-state";
import {
  classifySilentHttpSuccess,
  mustNotInventRefundCash,
  reconcileStripePaymentIntent,
  stripeAmountFromBrl,
  type StripeCardIntentSnapshot,
  type StripeIntentOperation,
  type StripeReconcileDecision,
} from "@/lib/domain/stripe-card";

export { mustNotInventRefundCash };

export const STRIPE_PIX_CURRENCY = "brl" as const;

export type StripePixIntentOperation = "create" | "cancel" | "reconcile";

export type StripePixQr = {
  data: string;
  imageUrlPng?: string;
  imageUrlSvg?: string;
  expiresAt?: number;
  hostedInstructionsUrl?: string;
};

export type StripePixIntentSnapshot = StripeCardIntentSnapshot & {
  qr?: StripePixQr | null;
  paymentMethodTypes?: string[];
};

export function pixRefundStatusPendingExternal(): "pending_external" {
  return "pending_external";
}

export function mapStripePixIntentStatus(stripeStatus: string): PaymentState {
  switch (stripeStatus) {
    case "requires_action":
    case "requires_confirmation":
      return "pending";
    case "succeeded":
      return "captured";
    case "canceled":
      return "cancelled";
    case "requires_payment_method":
      return "failed";
    case "processing":
      return "unknown";
    default:
      return "unknown";
  }
}

export function classifySilentPixHttpSuccess(
  httpOk: boolean,
  snapshot: StripePixIntentSnapshot | null,
  operation: StripePixIntentOperation
): PaymentState | null {
  const mapped: StripeIntentOperation = operation === "create" ? "authorize" : operation;
  const silent = classifySilentHttpSuccess(httpOk, snapshot, mapped);
  if (silent) return silent;
  if (operation === "create" && snapshot && !snapshot.status) {
    return "unknown";
  }
  return null;
}

export function reconcileStripePixPaymentIntent(input: {
  expectedProviderRef: string;
  expectedAmount: string;
  expectedCurrency?: string;
  snapshot: StripePixIntentSnapshot | null;
}): StripeReconcileDecision {
  if (input.snapshot?.status === "requires_action" || input.snapshot?.status === "requires_confirmation") {
    const base = reconcileStripePaymentIntent(input);
    if (base.mismatch && base.status === "unknown" && input.snapshot.id === input.expectedProviderRef) {
      return {
        status: "pending",
        message: "PaymentIntent PIX aguardando pagamento (QR).",
        providerReference: input.snapshot.id,
        mismatch: false,
      };
    }
  }
  return reconcileStripePaymentIntent(input);
}

export function extractPixQr(nextAction: unknown): StripePixQr | null {
  if (!nextAction || typeof nextAction !== "object") return null;
  const action = nextAction as {
    type?: unknown;
    pix_display_qr_code?: {
      data?: unknown;
      image_url_png?: unknown;
      image_url_svg?: unknown;
      expires_at?: unknown;
      hosted_instructions_url?: unknown;
    };
  };
  if (action.type !== "pix_display_qr_code" || !action.pix_display_qr_code) {
    return null;
  }
  const qr = action.pix_display_qr_code;
  if (typeof qr.data !== "string" || qr.data.length === 0) {
    return null;
  }
  return {
    data: qr.data,
    imageUrlPng: typeof qr.image_url_png === "string" ? qr.image_url_png : undefined,
    imageUrlSvg: typeof qr.image_url_svg === "string" ? qr.image_url_svg : undefined,
    expiresAt: typeof qr.expires_at === "number" ? qr.expires_at : undefined,
    hostedInstructionsUrl:
      typeof qr.hosted_instructions_url === "string" ? qr.hosted_instructions_url : undefined,
  };
}

export function isPixStripeObject(object: Record<string, unknown>): boolean {
  const types = object.payment_method_types;
  if (Array.isArray(types) && types.some((type) => type === "pix")) {
    return true;
  }

  const paymentMethod = object.payment_method;
  if (paymentMethod && typeof paymentMethod === "object") {
    const typed = paymentMethod as { type?: unknown };
    if (typed.type === "pix") return true;
  }

  const details = object.payment_method_details;
  if (details && typeof details === "object") {
    const typed = details as { type?: unknown };
    if (typed.type === "pix") return true;
  }

  if (extractPixQr(object.next_action)) {
    return true;
  }

  return false;
}

export { stripeAmountFromBrl };

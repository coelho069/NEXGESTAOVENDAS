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

/** PIX QR default expiry: 3600s (1h). Stripe accepts 10..1209600 seconds. */
export const STRIPE_PIX_DEFAULT_EXPIRES_SECONDS = 3600;
export const STRIPE_PIX_MIN_EXPIRES_SECONDS = 10;
export const STRIPE_PIX_MAX_EXPIRES_SECONDS = 1_209_600;

/**
 * Reads `STRIPE_PIX_EXPIRES_SECONDS`, falling back to 3600. Values outside the
 * Stripe-supported window are clamped — never rejected at request time.
 */
export function stripePixExpiresAfterSeconds(
  envSource: Record<string, string | undefined> = process.env
): number {
  const raw = Number.parseInt(envSource.STRIPE_PIX_EXPIRES_SECONDS ?? "", 10);
  if (!Number.isFinite(raw)) return STRIPE_PIX_DEFAULT_EXPIRES_SECONDS;
  return Math.min(Math.max(raw, STRIPE_PIX_MIN_EXPIRES_SECONDS), STRIPE_PIX_MAX_EXPIRES_SECONDS);
}

/** Machine-readable outcome when the Stripe account has PIX disabled. */
export const PIX_NOT_ENABLED_ON_ACCOUNT = "PIX_NOT_ENABLED_ON_ACCOUNT" as const;
export const PIX_NOT_ENABLED_ON_ACCOUNT_HINT =
  "Dashboard Stripe → Settings → Payment methods → ativar PIX (Brasil)";

export class PixNotEnabledOnAccountError extends Error {
  readonly code = PIX_NOT_ENABLED_ON_ACCOUNT;
  readonly hint = PIX_NOT_ENABLED_ON_ACCOUNT_HINT;

  constructor(message = "PIX não habilitado nesta conta Stripe.") {
    super(message);
    this.name = "PixNotEnabledOnAccountError";
  }
}

/**
 * Detects the Stripe API refusal for an account without PIX enabled.
 * Only errors that explicitly reference pix + an unsupported/invalid payment
 * method type are matched, so unrelated Stripe failures keep their own path.
 */
export function isPixNotEnabledOnAccountError(error: unknown): boolean {
  if (error instanceof PixNotEnabledOnAccountError) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as { message?: unknown; code?: unknown; type?: unknown };
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  const code = typeof candidate.code === "string" ? candidate.code.toLowerCase() : "";
  const type = typeof candidate.type === "string" ? candidate.type : "";
  if (!message.includes("pix") && !code.includes("pix")) return false;
  const markers = [
    "payment_method_type",
    "payment method type",
    "payment_method_types",
    "not supported",
    "unsupported",
    "not enabled",
    "invalid payment_method",
    "parameter_invalid",
  ];
  return (
    type === "invalid_request_error" ||
    markers.some((marker) => message.includes(marker) || code.includes(marker))
  );
}

export type PixCheckoutGateReason = "hold" | "not_configured" | "livemode" | "offline" | "ok";

export type PixCheckoutGate = {
  selectable: boolean;
  reason: PixCheckoutGateReason;
};

/** Strict opt-in. `"TRUE"`, `"1"`, `"yes"` and unset stay hold. Never default true. */
export function isPixCheckoutEnabledEnv(value: string | undefined): boolean {
  return value === "true";
}

/**
 * PIX is selectable only with explicit flag + Stripe secrets/health testmode + online.
 * Flag off is hold; missing secrets is not_configured. Offline never opens PIX.
 */
export function evaluatePixCheckoutGate(input: {
  flagEnabled: boolean;
  healthConfigured: boolean;
  healthTestmode: boolean;
  online: boolean;
}): PixCheckoutGate {
  if (!input.flagEnabled) return { selectable: false, reason: "hold" };
  if (!input.healthConfigured) return { selectable: false, reason: "not_configured" };
  if (!input.healthTestmode) return { selectable: false, reason: "livemode" };
  if (!input.online) return { selectable: false, reason: "offline" };
  return { selectable: true, reason: "ok" };
}

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

import {
  isPixNotEnabledOnAccountError,
  PIX_NOT_ENABLED_ON_ACCOUNT,
} from "@/lib/domain/stripe-pix";

export {
  PIX_NOT_ENABLED_ON_ACCOUNT,
  PixNotEnabledOnAccountError,
} from "@/lib/domain/stripe-pix";

/** Machine-readable failures beyond a specific PIX refusal. */
export const STRIPE_ERROR = "STRIPE_ERROR" as const;
export const NO_PAYMENT_PROVIDER = "NO_PAYMENT_PROVIDER" as const;

export type PaymentFallbackCode =
  | typeof PIX_NOT_ENABLED_ON_ACCOUNT
  | typeof STRIPE_ERROR
  | typeof NO_PAYMENT_PROVIDER
  | null;

export type PaymentProvider = "stripe" | "mercadopago";
export type PaymentFallbackMethod = "pix" | "card" | "other";

/**
 * Stable, UI-facing response contract for create-payment. Every branch of the
 * fallback flow returns exactly this shape — never a bare 500 / white screen.
 */
export type CreatePaymentResult = {
  ok: boolean;
  provider: PaymentProvider | null;
  method: PaymentFallbackMethod;
  fallback: boolean;
  code: PaymentFallbackCode;
  client_secret: string | null;
  message: string;
};

/**
 * Detects the Stripe API refusal for an account without PIX enabled, OR any
 * error whose Stripe code / decline_code / param explicitly names "pix" as
 * unsupported. Mirrors the message shapes the Stripe SDK can surface:
 *
 * - `payment method type \`pix\` is invalid`
 * - `payment_method_types must be one of card, ...`
 * - `pix is not activated / not enabled / not available`
 *
 * Unrelated Stripe failures (network, auth, rate-limit) never match and keep
 * their own error path (STRIPE_ERROR).
 */
export function isPixUnavailableError(error: unknown): boolean {
  if (isPixNotEnabledOnAccountError(error)) return true;
  if (!error || typeof error !== "object") return false;

  const candidate = error as {
    message?: unknown;
    code?: unknown;
    type?: unknown;
    decline_code?: unknown;
    param?: unknown;
  };

  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  const code = typeof candidate.code === "string" ? candidate.code.toLowerCase() : "";
  const type = typeof candidate.type === "string" ? candidate.type.toLowerCase() : "";
  const declineCode =
    typeof candidate.decline_code === "string" ? candidate.decline_code.toLowerCase() : "";
  const param = typeof candidate.param === "string" ? candidate.param.toLowerCase() : "";

  // Only errors that name "pix" OR reference the payment_method_types param are eligible.
  const mentionsPix =
    [message, code, param].some((value) => value.includes("pix")) ||
    message.includes("payment_method_types") ||
    param === "payment_method_types";
  if (!mentionsPix) return false;

  const markers = [
    "is invalid",
    "invalid payment_method",
    "payment method type",
    "must be one of",
    "not supported",
    "unsupported",
    "not activated",
    "not enabled",
    "not available",
    "payment_method_not_available",
    "invalid_request_error",
  ];

  return (
    type === "invalid_request_error" ||
    declineCode === "invalid_request_error" ||
    code === "parameter_invalid" ||
    markers.some((marker) => message.includes(marker) || code.includes(marker))
  );
}

/** Short pt-BR copy shown when PIX is unavailable and the checkout falls back. */
export const PIX_FALLBACK_BANNER_MESSAGE =
  "PIX ainda não está ativo nesta conta Stripe. Pagamento seguirá com cartão.";

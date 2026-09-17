import { money, toMoneyString } from "@/lib/money";
import type { PaymentState } from "@/lib/domain/payment-state";
import type { StripePixQr } from "@/lib/domain/stripe-pix";

export const MERCADOPAGO_CURRENCY = "BRL" as const;
export const MERCADOPAGO_API_BASE = "https://api.mercadopago.com" as const;

export const MERCADOPAGO_WEBHOOK_EVENT_ALLOWLIST = [
  "order.created",
  "order.updated",
  "order.processed",
  "order.action_required",
  "order.canceled",
  "order.refunded",
] as const;

export type MercadoPagoWebhookAction = (typeof MERCADOPAGO_WEBHOOK_EVENT_ALLOWLIST)[number];

export type MercadoPagoOrderOperation = "create" | "cancel" | "reconcile";

export type MercadoPagoOrderSnapshot = {
  id: string;
  status: string;
  statusDetail: string;
  amount: string;
  currency: string;
  livemode: boolean;
  received: boolean;
  qr?: MercadoPagoPixQr | null;
  paymentId?: string;
};

export type MercadoPagoPixQr = StripePixQr;

export type MercadoPagoReconcileDecision = {
  status: PaymentState;
  message: string;
  providerReference?: string;
  mismatch: boolean;
};

export type MercadoPagoWebhookNotification = {
  id: string | number;
  type: string;
  action: string;
  live_mode?: boolean;
  data: { id?: string };
};

/** Strict opt-in. Unset/false stays hold. Never default true. */
export function isMercadoPagoCheckoutEnabledEnv(value: string | undefined): boolean {
  return value === "true";
}

export function isMercadoPagoWebhookEventAllowed(action: string): action is MercadoPagoWebhookAction {
  return (MERCADOPAGO_WEBHOOK_EVENT_ALLOWLIST as readonly string[]).includes(action);
}

export function normalizeMercadoPagoAmount(amount: string): string {
  const normalized = toMoneyString(money(amount));
  if (money(normalized).lte(0)) {
    throw new Error("invalid_mercadopago_amount");
  }
  return normalized;
}

export function amountsMatchMercadoPago(localAmount: string, orderAmount: string): boolean {
  try {
    return money(normalizeMercadoPagoAmount(localAmount)).eq(money(normalizeMercadoPagoAmount(orderAmount)));
  } catch {
    return false;
  }
}

export function mapMercadoPagoOrderStatus(
  orderStatus: string,
  statusDetail: string,
  operation: MercadoPagoOrderOperation
): PaymentState {
  if (orderStatus === "processed" && statusDetail === "accredited") {
    return "captured";
  }
  if (orderStatus === "refunded") {
    return "refunded";
  }
  if (orderStatus === "canceled" || orderStatus === "cancelled") {
    return "cancelled";
  }
  if (orderStatus === "action_required") {
    if (statusDetail === "waiting_capture") {
      return operation === "create" ? "authorized" : "pending";
    }
    if (statusDetail === "waiting_transfer" || statusDetail === "waiting_payment") {
      return "pending";
    }
    return "pending";
  }
  if (orderStatus === "processing") {
    return "unknown";
  }
  if (orderStatus === "created") {
    return operation === "create" ? "pending" : "unknown";
  }
  return "unknown";
}

export function classifySilentMercadoPagoHttpSuccess(
  httpOk: boolean,
  snapshot: MercadoPagoOrderSnapshot | null,
  operation: MercadoPagoOrderOperation
): PaymentState | null {
  if (!httpOk) return "unknown";
  if (!snapshot?.received || !snapshot.id || !snapshot.status) {
    return "unknown";
  }
  if (operation === "reconcile" && snapshot.status === "processed" && snapshot.statusDetail !== "accredited") {
    return "unknown";
  }
  return null;
}

export function reconcileMercadoPagoOrder(input: {
  expectedProviderRef: string;
  expectedAmount: string;
  snapshot: MercadoPagoOrderSnapshot | null;
}): MercadoPagoReconcileDecision {
  if (!input.snapshot?.received || !input.snapshot.id) {
    return {
      status: "unknown",
      message: "Ordem Mercado Pago não encontrada na reconciliação.",
      mismatch: true,
    };
  }

  if (input.snapshot.id !== input.expectedProviderRef) {
    return {
      status: "unknown",
      message: "provider_reference divergente na reconciliação Mercado Pago.",
      providerReference: input.snapshot.id,
      mismatch: true,
    };
  }

  if (!amountsMatchMercadoPago(input.expectedAmount, input.snapshot.amount)) {
    return {
      status: "unknown",
      message: "Valor da ordem Mercado Pago divergente.",
      providerReference: input.snapshot.id,
      mismatch: true,
    };
  }

  const status = mapMercadoPagoOrderStatus(
    input.snapshot.status,
    input.snapshot.statusDetail,
    "reconcile"
  );

  if (input.snapshot.status === "action_required") {
    return {
      status: "pending",
      message: "Ordem Mercado Pago aguardando pagamento.",
      providerReference: input.snapshot.id,
      mismatch: false,
    };
  }

  return {
    status,
    message: `Reconciliação Mercado Pago → ${status}.`,
    providerReference: input.snapshot.id,
    mismatch: false,
  };
}

export function webhookActionToPaymentState(action: string): PaymentState | "ignored" {
  if (!isMercadoPagoWebhookEventAllowed(action)) {
    return "ignored";
  }
  switch (action) {
    case "order.processed":
      return "captured";
    case "order.canceled":
      return "cancelled";
    case "order.refunded":
      return "refunded";
    case "order.created":
    case "order.updated":
    case "order.action_required":
      return "pending";
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export function extractMercadoPagoPixQr(paymentMethod: unknown): MercadoPagoPixQr | null {
  if (!paymentMethod || typeof paymentMethod !== "object") return null;
  const method = paymentMethod as {
    id?: unknown;
    qr_code?: unknown;
    qr_code_base64?: unknown;
    ticket_url?: unknown;
  };
  if (method.id !== "pix") return null;
  if (typeof method.qr_code !== "string" || method.qr_code.length === 0) {
    return null;
  }
  return {
    data: method.qr_code,
    imageUrlPng:
      typeof method.qr_code_base64 === "string" && method.qr_code_base64.length > 0
        ? `data:image/png;base64,${method.qr_code_base64}`
        : undefined,
    hostedInstructionsUrl: typeof method.ticket_url === "string" ? method.ticket_url : undefined,
  };
}

export function parseMercadoPagoOrderResponse(body: unknown): MercadoPagoOrderSnapshot | null {
  if (!body || typeof body !== "object") return null;
  const order = body as {
    id?: unknown;
    status?: unknown;
    status_detail?: unknown;
    total_amount?: unknown;
    live_mode?: unknown;
    transactions?: {
      payments?: Array<{
        id?: unknown;
        amount?: unknown;
        payment_method?: unknown;
      }>;
    };
  };

  if (typeof order.id !== "string" || order.id.length === 0) return null;
  const payment = order.transactions?.payments?.[0];
  const amount =
    typeof order.total_amount === "string"
      ? order.total_amount
      : typeof payment?.amount === "string"
        ? payment.amount
        : "0.00";

  return {
    id: order.id,
    status: typeof order.status === "string" ? order.status : "",
    statusDetail: typeof order.status_detail === "string" ? order.status_detail : "",
    amount,
    currency: MERCADOPAGO_CURRENCY,
    livemode: order.live_mode === true,
    received: true,
    qr: extractMercadoPagoPixQr(payment?.payment_method),
    paymentId: typeof payment?.id === "string" ? payment.id : undefined,
  };
}

export function parseMercadoPagoWebhookNotification(body: unknown): MercadoPagoWebhookNotification | null {
  if (!body || typeof body !== "object") return null;
  const payload = body as {
    id?: unknown;
    type?: unknown;
    action?: unknown;
    live_mode?: unknown;
    data?: { id?: unknown };
  };
  if (payload.id === undefined || payload.id === null) return null;
  if (typeof payload.type !== "string" || typeof payload.action !== "string") return null;
  return {
    id: payload.id as string | number,
    type: payload.type,
    action: payload.action,
    live_mode: payload.live_mode === true,
    data: {
      id: typeof payload.data?.id === "string" ? payload.data.id : undefined,
    },
  };
}

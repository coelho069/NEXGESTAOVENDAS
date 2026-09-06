import type { Enums } from "@/lib/db/types";
import type { PaymentState } from "@/lib/domain/payment-state";

/**
 * Commercial payment kinds used by PDV/UX.
 * Persist only via {@link toDbPaymentMethod} into the Postgres enum.
 */
export const PAYMENT_METHOD_KINDS = [
  "cash",
  "pix",
  "credit_card",
  "debit_card",
  "tef",
] as const;

export type PaymentMethodKind = (typeof PAYMENT_METHOD_KINDS)[number];

/** Lifecycle labels used in PIX flows; persisted statuses stay on PaymentState. */
export const PAYMENT_LIFECYCLE_STATUSES = [
  "pending",
  "authorized",
  "paid",
  "failed",
  "cancelled",
  "refunded",
  "expired",
] as const;

export type PaymentLifecycleStatus = (typeof PAYMENT_LIFECYCLE_STATUSES)[number];

export type PaymentContract = {
  paymentId: string;
  saleId: string;
  method: PaymentMethodKind | Enums<"payment_method">;
  amount: string;
  status: PaymentState;
  provider: string | null;
  externalReference: string | null;
  idempotencyKey: string;
  adapterStatus: Enums<"adapter_status">;
  createdAt: string;
  updatedAt: string;
  reconciledAt?: string | null;
};

export type PixChargeIntent = {
  storeId: string;
  amount: string;
  clientMutationId: string;
  saleId?: string;
  orgId?: string;
};

export type PixOperationResult = {
  status: PaymentLifecycleStatus | "not_configured" | "unknown";
  message: string;
  provider: string;
  externalReference?: string;
  paymentId?: string;
};

/** Commercial card kinds persisted as Postgres `card`. */
export type CardPaymentKind = "credit_card" | "debit_card";

export type CardChargeIntent = {
  storeId: string;
  amount: string;
  clientMutationId: string;
  kind: CardPaymentKind;
  saleId?: string;
  orgId?: string;
};

export type CardOperationResult = {
  status: PaymentLifecycleStatus | "not_configured" | "unknown";
  message: string;
  provider: string;
  kind: CardPaymentKind;
  externalReference?: string;
  authorizationCode?: string;
  paymentId?: string;
};

/**
 * TEF transaction intent. Terminal/NSU/auth codes are never trusted from the
 * client as approval evidence — only as request correlation until a live provider exists.
 */
export type TefTransactionIntent = {
  storeId: string;
  amount: string;
  clientMutationId: string;
  terminalId?: string;
  saleId?: string;
  orgId?: string;
};

export type TefOperationResult = {
  status: PaymentLifecycleStatus | "not_configured" | "unknown";
  message: string;
  provider: string;
  terminalId?: string;
  externalTransactionId?: string;
  authorizationCode?: string;
  nsu?: string;
  amount?: string;
  method: "tef";
  paymentId?: string;
};

export function isPaymentMethodKind(value: string): value is PaymentMethodKind {
  return (PAYMENT_METHOD_KINDS as readonly string[]).includes(value);
}

export function toDbPaymentMethod(
  method: PaymentMethodKind | Enums<"payment_method">
): Enums<"payment_method"> {
  switch (method) {
    case "cash":
      return "cash";
    case "pix":
      return "pix";
    case "credit_card":
    case "debit_card":
      return "card";
    case "tef":
      return "other";
    case "card":
      return "card";
    case "voucher":
      return "voucher";
    case "other":
      return "other";
    default:
      return "other";
  }
}

export function fromDbPaymentMethod(method: Enums<"payment_method">): PaymentMethodKind | Enums<"payment_method"> {
  return method;
}

/** Map lifecycle vocabulary onto persisted payment_status values. */
export function toPersistedPaymentStatus(
  status: PaymentLifecycleStatus | PaymentState | "not_configured"
): PaymentState | "not_configured" {
  if (status === "not_configured") return "not_configured";
  if (status === "paid") return "captured";
  if (status === "expired") return "failed";
  return status;
}

export function toLifecyclePaymentStatus(
  status: PaymentState
): PaymentLifecycleStatus | "unknown" {
  if (status === "captured") return "paid";
  if (status === "unknown") return "unknown";
  return status;
}

export function isElectronicPaymentMethod(
  method: PaymentMethodKind | Enums<"payment_method">
): boolean {
  const db = toDbPaymentMethod(method);
  return db !== "cash";
}

/** PIX (and other non-cash methods) cannot be finalized while offline. */
export function canCompletePaymentOffline(
  method: PaymentMethodKind | Enums<"payment_method">
): boolean {
  return toDbPaymentMethod(method) === "cash";
}

export function offlinePaymentBlockedMessage(
  method: PaymentMethodKind | Enums<"payment_method">
): string {
  if (method === "pix") {
    return "PIX indisponível offline. Conecte-se para cobrar ou use dinheiro.";
  }
  if (method === "credit_card") {
    return "Cartão de crédito indisponível offline. Conecte-se ou use dinheiro.";
  }
  if (method === "debit_card") {
    return "Cartão de débito indisponível offline. Conecte-se ou use dinheiro.";
  }
  if (method === "tef") {
    return "TEF indisponível offline. Conecte-se ou use dinheiro.";
  }
  const db = toDbPaymentMethod(method);
  if (db === "card") {
    return "Cartão indisponível offline. Conecte-se ou use dinheiro.";
  }
  if (db === "other") {
    return "TEF/outros meios indisponíveis offline. Conecte-se ou use dinheiro.";
  }
  return `Pagamento ${db} indisponível offline. Conecte-se ou use dinheiro.`;
}

export function paymentNotConfiguredMessage(
  method: PaymentMethodKind | Enums<"payment_method">
): string {
  if (method === "pix") {
    return "PIX não configurado. Configure o provedor antes de cobrar.";
  }
  if (method === "credit_card") {
    return "Cartão de crédito não configurado. Configure o provedor antes de usar.";
  }
  if (method === "debit_card") {
    return "Cartão de débito não configurado. Configure o provedor antes de usar.";
  }
  if (method === "tef") {
    return "TEF não configurado. Configure o provedor/terminal antes de usar.";
  }
  const db = toDbPaymentMethod(method);
  if (db === "card") {
    return "Cartão não configurado. Configure o provedor antes de usar.";
  }
  if (db === "other") {
    return "TEF/outros meios não configurados. Configure o provedor antes de usar.";
  }
  return `Pagamento ${db} não configurado. Configure o provedor antes de usar.`;
}

/**
 * Project a persisted/local payment row onto the shared payment contract.
 * Provider is never taken from the client — only adapter/config projections.
 */
export function buildPaymentContract(input: {
  paymentId: string;
  saleId: string;
  method: PaymentMethodKind | Enums<"payment_method">;
  amount: string;
  status: PaymentState;
  provider?: string | null;
  externalReference?: string | null;
  idempotencyKey: string;
  adapterStatus?: Enums<"adapter_status">;
  createdAt: string;
  updatedAt: string;
  reconciledAt?: string | null;
}): PaymentContract {
  return {
    paymentId: input.paymentId,
    saleId: input.saleId,
    method: input.method,
    amount: input.amount,
    status: input.status,
    provider: input.provider ?? null,
    externalReference: input.externalReference ?? null,
    idempotencyKey: input.idempotencyKey,
    adapterStatus: input.adapterStatus ?? "not_configured",
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    reconciledAt: input.reconciledAt ?? null,
  };
}

/**
 * B18 compatibility: without a live PIX provider, external refunds stay pending.
 * Never invent a completed external refund or cash movement.
 */
export function resolvePixExternalRefundOutcome(): {
  status: "not_configured";
  paymentRefundStatus: "pending_external";
  message: string;
} {
  return {
    status: "not_configured",
    paymentRefundStatus: "pending_external",
    message: "Estorno PIX externo indisponível: provedor não configurado.",
  };
}

/** B18: card refunds without a live provider stay pending_external (no cash-out). */
export function resolveCardExternalRefundOutcome(kind: CardPaymentKind = "credit_card"): {
  status: "not_configured";
  paymentRefundStatus: "pending_external";
  message: string;
} {
  const label = kind === "debit_card" ? "débito" : "crédito";
  return {
    status: "not_configured",
    paymentRefundStatus: "pending_external",
    message: `Estorno de cartão (${label}) externo indisponível: provedor não configurado.`,
  };
}

/** B18: TEF refunds without a live provider stay pending_external (no cash-out). */
export function resolveTefExternalRefundOutcome(): {
  status: "not_configured";
  paymentRefundStatus: "pending_external";
  message: string;
} {
  return {
    status: "not_configured",
    paymentRefundStatus: "pending_external",
    message: "Estorno TEF externo indisponível: provedor/terminal não configurado.",
  };
}

/**
 * Reject fabricated paid/captured outcomes.
 * `authorized` remains a valid future provider state and is not blocked here.
 */
export function assertElectronicResultNotFakePaid(
  status: PaymentLifecycleStatus | PaymentState | "not_configured" | "unknown",
  label = "electronic"
): void {
  if (status === "paid" || status === "captured") {
    throw new Error(`${label}_illegal_paid_status`);
  }
}

/** Reject any attempt to treat a non-configured PIX result as paid. */
export function assertPixResultNotFakePaid(
  status: PaymentLifecycleStatus | PaymentState | "not_configured" | "unknown"
): void {
  if (status === "paid" || status === "captured") {
    throw new Error("pix_illegal_paid_status");
  }
}

export function assertCardResultNotFakePaid(
  status: PaymentLifecycleStatus | PaymentState | "not_configured" | "unknown"
): void {
  assertElectronicResultNotFakePaid(status, "card");
}

export function assertTefResultNotFakePaid(
  status: PaymentLifecycleStatus | PaymentState | "not_configured" | "unknown"
): void {
  assertElectronicResultNotFakePaid(status, "tef");
}

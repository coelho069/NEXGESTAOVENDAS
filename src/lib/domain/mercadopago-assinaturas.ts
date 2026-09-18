import { toMoneyString, money } from "@/lib/money";
import type { SubscriptionBillingInterval } from "@/lib/domain/admin-subscriptions";

export const MERCADOPAGO_ASSINATURAS_API_BASE = "https://api.mercadopago.com" as const;

export const MERCADOPAGO_ASSINATURAS_WEBHOOK_ALLOWLIST = [
  "subscription_preapproval",
  "subscription_authorized_payment",
] as const;

export type MercadoPagoAssinaturasWebhookType =
  (typeof MERCADOPAGO_ASSINATURAS_WEBHOOK_ALLOWLIST)[number];

export type MercadoPagoAssinaturasWebhookNotification = {
  id: string | number;
  type: string;
  action: string;
  live_mode?: boolean;
  data: { id?: string };
};

export type MercadoPagoPreapprovalPlanSnapshot = {
  id: string;
  status: string;
  reason: string;
};

export type MercadoPagoPreapprovalSnapshot = {
  id: string;
  status: string;
  reason: string;
  initPoint: string | null;
  sandboxInitPoint: string | null;
  externalReference: string | null;
  payerEmail: string | null;
  preapprovalPlanId: string | null;
};

export type MercadoPagoAssinaturasSubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled";

/** Strict opt-in. Unset/false stays hold. Never default true. */
export function isMercadoPagoAssinaturasCheckoutEnabledEnv(value: string | undefined): boolean {
  return value === "true";
}

export function isMercadoPagoAssinaturasWebhookTypeAllowed(
  type: string
): type is MercadoPagoAssinaturasWebhookType {
  return (MERCADOPAGO_ASSINATURAS_WEBHOOK_ALLOWLIST as readonly string[]).includes(type);
}

export function parseMercadoPagoAssinaturasWebhookNotification(
  body: unknown
): MercadoPagoAssinaturasWebhookNotification | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const id = record.id;
  const type = record.type;
  const action = record.action;
  const data = record.data;
  if (
    (typeof id !== "string" && typeof id !== "number") ||
    typeof type !== "string" ||
    typeof action !== "string" ||
    !data ||
    typeof data !== "object"
  ) {
    return null;
  }
  const dataId = (data as Record<string, unknown>).id;
  return {
    id,
    type,
    action,
    live_mode: typeof record.live_mode === "boolean" ? record.live_mode : undefined,
    data: { id: typeof dataId === "string" ? dataId : undefined },
  };
}

export function parseMercadoPagoPreapprovalPlanResponse(body: unknown): MercadoPagoPreapprovalPlanSnapshot | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const id = record.id;
  const status = record.status;
  const reason = record.reason;
  if (typeof id !== "string" || typeof status !== "string") return null;
  return {
    id,
    status,
    reason: typeof reason === "string" ? reason : "",
  };
}

export function parseMercadoPagoPreapprovalResponse(body: unknown): MercadoPagoPreapprovalSnapshot | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const id = record.id;
  const status = record.status;
  const reason = record.reason;
  if (typeof id !== "string" || typeof status !== "string") return null;

  const payer = record.payer;
  const payerEmail =
    payer && typeof payer === "object" && typeof (payer as Record<string, unknown>).email === "string"
      ? ((payer as Record<string, unknown>).email as string)
      : null;

  return {
    id,
    status,
    reason: typeof reason === "string" ? reason : "",
    initPoint: typeof record.init_point === "string" ? record.init_point : null,
    sandboxInitPoint: typeof record.sandbox_init_point === "string" ? record.sandbox_init_point : null,
    externalReference:
      typeof record.external_reference === "string" ? record.external_reference : null,
    payerEmail,
    preapprovalPlanId:
      typeof record.preapproval_plan_id === "string" ? record.preapproval_plan_id : null,
  };
}

export function billingIntervalToMercadoPagoRecurring(interval: SubscriptionBillingInterval): {
  frequency: number;
  frequency_type: "months";
} {
  switch (interval) {
    case "monthly":
      return { frequency: 1, frequency_type: "months" };
    case "yearly":
      return { frequency: 12, frequency_type: "months" };
    default: {
      const _never: never = interval;
      return _never;
    }
  }
}

export function normalizeMercadoPagoAssinaturasAmount(amount: string): string {
  const normalized = toMoneyString(money(amount));
  if (money(normalized).lte(0)) {
    throw new Error("invalid_mercadopago_assinaturas_amount");
  }
  return normalized;
}

export function buildAssinaturasExternalReference(orgId: string, clientMutationId: string): string {
  return `nex:org:${orgId}:mut:${clientMutationId}`;
}

export function parseAssinaturasExternalReference(
  externalReference: string | null | undefined
): { orgId: string; clientMutationId: string } | null {
  if (!externalReference) return null;
  const match = /^nex:org:([0-9a-f-]{36}):mut:([0-9a-f-]{36})$/i.exec(externalReference.trim());
  if (!match) return null;
  return { orgId: match[1], clientMutationId: match[2] };
}

export function mapMercadoPagoPreapprovalStatusToSubscriptionStatus(
  status: string
): MercadoPagoAssinaturasSubscriptionStatus {
  const normalized = status.trim().toLowerCase();
  switch (normalized) {
    case "authorized":
      return "active";
    case "pending":
      return "trialing";
    case "paused":
      return "past_due";
    case "cancelled":
    case "canceled":
      return "canceled";
    default:
      return "trialing";
  }
}

export function addBillingPeriodStart(start: Date, interval: SubscriptionBillingInterval): Date {
  const end = new Date(start);
  switch (interval) {
    case "monthly":
      end.setUTCMonth(end.getUTCMonth() + 1);
      return end;
    case "yearly":
      end.setUTCFullYear(end.getUTCFullYear() + 1);
      return end;
    default: {
      const _never: never = interval;
      return _never;
    }
  }
}

export function formatDateOnlyUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

import type { MemberRole } from "@/lib/domain/rbac";
import {
  gateTenantSubscriptionAccess,
  resolveSubscriptionCheck,
  subscriptionBlockTitle,
  type SubscriptionGateDecision,
} from "@/lib/domain/subscription-access";

/** Recorded subscription statuses compatible with the current access gate. */
export const SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "expired",
  "canceled",
  "cancelled",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const ADMIN_SUBSCRIPTION_STATUSES = [...SUBSCRIPTION_STATUSES, "none"] as const;

export type AdminSubscriptionStatus = (typeof ADMIN_SUBSCRIPTION_STATUSES)[number];

export const ADMIN_PDV_STATUSES = ["active", "inactive", "unknown"] as const;

export type AdminPdvStatus = (typeof ADMIN_PDV_STATUSES)[number];

export const SUBSCRIPTION_BILLING_INTERVALS = ["monthly", "yearly"] as const;

export type SubscriptionBillingInterval = (typeof SUBSCRIPTION_BILLING_INTERVALS)[number];

export type AdminSubscriptionFilters = {
  query?: string;
  plan?: string;
  planId?: string;
  status?: AdminSubscriptionStatus;
  expiresFrom?: string;
  expiresTo?: string;
};

export type AdminPlanRecord = {
  id: string;
  name: string;
  description: string;
  amount: string;
  currency: string;
  billingInterval: SubscriptionBillingInterval;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  subscriptionCount: number;
};

export type AdminStoreRecord = {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  lastUpdated: string;
};

export type AdminContactRecord = {
  id: string;
  fullName: string;
  email: string;
  role: MemberRole | null;
};

export type AdminSubscriptionRecord = {
  id: string;
  subscriptionId: string | null;
  clientName: string;
  clientSlug: string;
  planId: string | null;
  planName: string | null;
  status: AdminSubscriptionStatus;
  billingInterval: SubscriptionBillingInterval | null;
  startedAt: string | null;
  expiresAt: string | null;
  amount: string | null;
  cancelledAt: string | null;
  subscriptionCreatedAt: string | null;
  subscriptionUpdatedAt: string | null;
  pdvStatus: AdminPdvStatus;
  accessAllowed: boolean;
  accessReason: string;
  accessMessage: string;
  lastUpdated: string;
  currency: string;
  timezone: string;
  storeCount: number;
  activeStoreCount: number;
  teamMemberCount: number;
  sourceEntity: "subscriptions" | "organizations";
};

export type AdminSubscriptionDetail = AdminSubscriptionRecord & {
  stores: AdminStoreRecord[];
  contacts: AdminContactRecord[];
};

export type AdminSubscriptionOverview = {
  totalClients: number;
  activeSubscriptions: number;
  trialingSubscriptions: number;
  pastDueSubscriptions: number;
  expiredSubscriptions: number;
  cancelledSubscriptions: number;
  noneSubscriptions: number;
};

export type AdminSubscriptionsPayload = {
  records: AdminSubscriptionRecord[];
  overview: AdminSubscriptionOverview;
  nextExpirations: AdminSubscriptionRecord[];
  plans: AdminPlanRecord[];
  subscriptionDataAvailable: boolean;
  dataAvailabilityMessage: string | null;
};

export const ADMIN_SUBSCRIPTION_STATUS_LABELS: Record<AdminSubscriptionStatus, string> = {
  active: "Ativa",
  trialing: "Em trial",
  past_due: "Em atraso",
  expired: "Vencida",
  canceled: "Cancelada",
  cancelled: "Cancelada",
  none: "Sem assinatura",
};

export const SUBSCRIPTION_BILLING_INTERVAL_LABELS: Record<SubscriptionBillingInterval, string> = {
  monthly: "Mensal",
  yearly: "Anual",
};

export const ADMIN_PDV_STATUS_LABELS: Record<AdminPdvStatus, string> = {
  active: "Operacional",
  inactive: "Inativo",
  unknown: "Indisponível",
};

const OPEN_STATUSES = new Set<AdminSubscriptionStatus>(["active", "trialing", "past_due"]);

export function isOpenSubscriptionStatus(status: AdminSubscriptionStatus): boolean {
  return OPEN_STATUSES.has(status);
}

export function normalizeAdminSubscriptionStatus(
  value: string | null | undefined
): AdminSubscriptionStatus {
  if (value == null || value.trim() === "") return "none";
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "active":
    case "trialing":
    case "past_due":
    case "expired":
    case "canceled":
    case "cancelled":
      return normalized;
    default:
      return "none";
  }
}

/** Latest subscription by created_at — matches tenant access lookup ordering. */
export function pickCurrentSubscription<T extends { created_at: string }>(
  rows: readonly T[]
): T | null {
  if (rows.length === 0) return null;
  return [...rows].sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null;
}

function accessMessageFor(decision: SubscriptionGateDecision): string {
  switch (decision.effectiveState) {
    case "active":
      return "Assinatura permite acesso operacional.";
    case "expired":
      return "Assinatura expirada — PDV bloqueado.";
    case "canceled":
      return "Assinatura cancelada — PDV bloqueado.";
    case "none":
      return "Organização sem assinatura cadastrada.";
    case "unavailable":
      return "Não foi possível validar a assinatura.";
    default: {
      const _never: never = decision.effectiveState;
      return _never;
    }
  }
}

export function describeSubscriptionAccessForAdmin(
  recordedStatus: string | null
): Pick<AdminSubscriptionRecord, "accessAllowed" | "accessReason" | "accessMessage"> {
  const check = resolveSubscriptionCheck(
    recordedStatus == null
      ? { kind: "success", recordedStatus: null }
      : { kind: "success", recordedStatus }
  );
  const decision = gateTenantSubscriptionAccess(check);
  return {
    accessAllowed: decision.allowed,
    accessReason: decision.reason,
    accessMessage:
      decision.effectiveState === "active"
        ? accessMessageFor(decision)
        : `${subscriptionBlockTitle(decision.effectiveState)}. ${accessMessageFor(decision)}`,
  };
}

export function compareSubscriptionExpiration(
  left: Pick<AdminSubscriptionRecord, "expiresAt" | "clientName">,
  right: Pick<AdminSubscriptionRecord, "expiresAt" | "clientName">
): number {
  if (left.expiresAt && right.expiresAt) {
    const byExpiration = left.expiresAt.localeCompare(right.expiresAt);
    if (byExpiration !== 0) return byExpiration;
  } else if (left.expiresAt) {
    return -1;
  } else if (right.expiresAt) {
    return 1;
  }
  return left.clientName.localeCompare(right.clientName, "pt-BR");
}

export function filterAdminSubscriptionRecords(
  records: readonly AdminSubscriptionRecord[],
  filters: AdminSubscriptionFilters
): AdminSubscriptionRecord[] {
  const query = filters.query?.trim().toLocaleLowerCase("pt-BR") ?? "";
  const plan = filters.plan?.trim().toLocaleLowerCase("pt-BR") ?? "";
  const planId = filters.planId?.trim() ?? "";

  return records
    .filter((record) => {
      if (
        query &&
        !`${record.clientName} ${record.clientSlug}`.toLocaleLowerCase("pt-BR").includes(query)
      ) {
        return false;
      }
      if (planId && record.planId !== planId) {
        return false;
      }
      if (plan && !(record.planName?.toLocaleLowerCase("pt-BR").includes(plan) ?? false)) {
        return false;
      }
      if (filters.status) {
        if (filters.status === "canceled" || filters.status === "cancelled") {
          if (record.status !== "canceled" && record.status !== "cancelled") return false;
        } else if (record.status !== filters.status) {
          return false;
        }
      }
      if (filters.expiresFrom && (!record.expiresAt || record.expiresAt.slice(0, 10) < filters.expiresFrom)) {
        return false;
      }
      if (filters.expiresTo && (!record.expiresAt || record.expiresAt.slice(0, 10) > filters.expiresTo)) {
        return false;
      }
      return true;
    })
    .sort(compareSubscriptionExpiration);
}

export function buildAdminSubscriptionOverview(
  records: readonly AdminSubscriptionRecord[]
): AdminSubscriptionOverview {
  return {
    totalClients: records.length,
    activeSubscriptions: records.filter((record) => record.status === "active").length,
    trialingSubscriptions: records.filter((record) => record.status === "trialing").length,
    pastDueSubscriptions: records.filter((record) => record.status === "past_due").length,
    expiredSubscriptions: records.filter((record) => record.status === "expired").length,
    cancelledSubscriptions: records.filter(
      (record) => record.status === "canceled" || record.status === "cancelled"
    ).length,
    noneSubscriptions: records.filter((record) => record.status === "none").length,
  };
}

export function findNextSubscriptionExpirations(
  records: readonly AdminSubscriptionRecord[],
  limit = 5
): AdminSubscriptionRecord[] {
  return records
    .filter((record) => isOpenSubscriptionStatus(record.status) && record.expiresAt !== null)
    .sort((left, right) => left.expiresAt!.localeCompare(right.expiresAt!))
    .slice(0, limit);
}

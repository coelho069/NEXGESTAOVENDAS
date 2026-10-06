import type { LucideIcon } from "lucide-react";
import { formatBRL } from "@/lib/money";
import {
  ADMIN_PDV_STATUS_LABELS,
  ADMIN_SUBSCRIPTION_STATUS_LABELS,
  SUBSCRIPTION_BILLING_INTERVAL_LABELS,
  type AdminPdvStatus,
  type AdminSubscriptionStatus,
  type SubscriptionBillingInterval,
} from "@/lib/domain/admin-subscriptions";
import type { MemberRole } from "@/lib/domain/rbac";

export function AdminDataNotice({ message }: { message: string }) {
  return (
    <div role="status" className="pdv-alert-warning flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
      <span className="mt-0.5 shrink-0 font-semibold text-amber-300">Cadastro</span>
      <span>{message}</span>
    </div>
  );
}

export function AdminErrorNotice({ message }: { message: string }) {
  return (
    <div role="alert" className="pdv-alert-error">
      {message}
    </div>
  );
}

export function AdminMetricCard({
  label,
  value,
  caption,
  icon: Icon,
  tone = "indigo",
}: {
  label: string;
  value: string;
  caption?: string;
  icon: LucideIcon;
  tone?: "indigo" | "emerald" | "amber" | "rose" | "slate";
}) {
  const toneClasses = {
    indigo: "border-primary/30 bg-primary/10 text-blue-300",
    emerald: "border-success/30 bg-success/10 text-emerald-300",
    amber: "border-warning/30 bg-warning/10 text-amber-300",
    rose: "border-destructive/30 bg-destructive/10 text-red-300",
    slate: "border-border bg-card text-muted-foreground",
  } as const;

  return (
    <article className="pdv-panel">
      <div className="flex items-start justify-between gap-3">
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-xl border ${toneClasses[tone]}`}
        >
          <Icon size={20} aria-hidden="true" />
        </span>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">ADM</span>
      </div>
      <p className="mt-5 text-sm font-medium text-muted-foreground">{label}</p>
      <p
        className="mt-1 text-2xl font-bold tracking-tight text-foreground tabular-nums"
        style={{ fontFamily: "var(--font-jakarta), system-ui, sans-serif" }}
      >
        {value}
      </p>
      {caption ? <p className="mt-1 text-xs text-muted-foreground">{caption}</p> : null}
    </article>
  );
}

export function SubscriptionStatusBadge({ status }: { status: AdminSubscriptionStatus }) {
  const classes: Record<AdminSubscriptionStatus, string> = {
    active: "border-success/35 bg-success/10 text-emerald-200",
    trialing: "border-primary/35 bg-primary/10 text-blue-200",
    past_due: "border-warning/35 bg-warning/10 text-amber-200",
    expired: "border-orange-500/35 bg-orange-500/10 text-orange-200",
    canceled: "border-destructive/35 bg-destructive/10 text-red-200",
    cancelled: "border-destructive/35 bg-destructive/10 text-red-200",
    none: "border-border bg-card text-muted-foreground",
  };

  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${classes[status]}`}
    >
      {ADMIN_SUBSCRIPTION_STATUS_LABELS[status]}
    </span>
  );
}

export function PdvStatusBadge({ status }: { status: AdminPdvStatus }) {
  const classes = {
    active: "border-success/35 bg-success/10 text-emerald-200",
    inactive: "border-destructive/35 bg-destructive/10 text-red-200",
    unknown: "border-border bg-card text-muted-foreground",
  } as const;

  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${classes[status]}`}
    >
      {ADMIN_PDV_STATUS_LABELS[status]}
    </span>
  );
}

export function formatAdminDate(value: string | null): string {
  if (!value) return "N/D";
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(isDateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return "N/D";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: isDateOnly ? "UTC" : "America/Sao_Paulo",
  }).format(date);
}

export function formatAdminAmount(value: string | null): string {
  return value === null ? "N/D" : formatBRL(value);
}

export function formatAdminBillingInterval(value: SubscriptionBillingInterval | null): string {
  return value ? SUBSCRIPTION_BILLING_INTERVAL_LABELS[value] : "N/D";
}

export function formatAdminSubscriptionPeriod(
  startedAt: string | null,
  expiresAt: string | null
): string {
  if (!startedAt && !expiresAt) return "N/D";
  if (startedAt && expiresAt) {
    return `${formatAdminDate(startedAt)} — ${formatAdminDate(expiresAt)}`;
  }
  return formatAdminDate(startedAt ?? expiresAt);
}

export function adminRoleLabel(role: MemberRole | null): string {
  if (role === "admin") return "Administrador";
  if (role === "manager") return "Gerente";
  if (role === "cashier") return "Caixa";
  if (role === "client") return "Cliente";
  return "Sem papel";
}

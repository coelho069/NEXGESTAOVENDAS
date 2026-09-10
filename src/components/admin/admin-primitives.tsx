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
    <div
      role="status"
      className="flex flex-col gap-1 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-start sm:gap-3"
    >
      <span className="mt-0.5 shrink-0 font-semibold text-amber-700">Cadastro</span>
      <span>{message}</span>
    </div>
  );
}

export function AdminErrorNotice({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
    >
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
    indigo: "bg-indigo-50 text-indigo-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    rose: "bg-rose-50 text-rose-600",
    slate: "bg-slate-100 text-slate-600",
  } as const;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${toneClasses[tone]}`}>
          <Icon size={20} aria-hidden="true" />
        </span>
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">ADM</span>
      </div>
      <p className="mt-5 text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">{value}</p>
      {caption ? <p className="mt-1 text-xs text-slate-400">{caption}</p> : null}
    </article>
  );
}

export function SubscriptionStatusBadge({ status }: { status: AdminSubscriptionStatus }) {
  const classes: Record<AdminSubscriptionStatus, string> = {
    active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    trialing: "bg-sky-50 text-sky-700 ring-sky-200",
    past_due: "bg-amber-50 text-amber-700 ring-amber-200",
    expired: "bg-orange-50 text-orange-700 ring-orange-200",
    canceled: "bg-rose-50 text-rose-700 ring-rose-200",
    cancelled: "bg-rose-50 text-rose-700 ring-rose-200",
    none: "bg-slate-100 text-slate-600 ring-slate-200",
  };

  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${classes[status]}`}
    >
      {ADMIN_SUBSCRIPTION_STATUS_LABELS[status]}
    </span>
  );
}

export function PdvStatusBadge({ status }: { status: AdminPdvStatus }) {
  const classes = {
    active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    inactive: "bg-rose-50 text-rose-700 ring-rose-200",
    unknown: "bg-slate-100 text-slate-600 ring-slate-200",
  } as const;

  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${classes[status]}`}
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

export function adminRoleLabel(role: MemberRole | null): string {
  if (role === "admin") return "Administrador";
  if (role === "manager") return "Gerente";
  if (role === "cashier") return "Caixa";
  return "Sem papel";
}

"use client";

import { useMemo, useState, useTransition } from "react";
import { AdminErrorNotice } from "@/components/admin/admin-primitives";
import { adminActionErrorMessage } from "@/components/admin/admin-action-messages";
import {
  ADMIN_SUBSCRIPTION_STATUS_LABELS,
  type AdminPlanRecord,
  type AdminSubscriptionDetail,
} from "@/lib/domain/admin-subscriptions";
import {
  cancelAdminSubscriptionAction,
  createAdminSubscriptionAction,
  updateAdminSubscriptionPeriodAction,
  updateAdminSubscriptionPlanAction,
  updateAdminSubscriptionStatusAction,
} from "@/lib/server/admin-platform-actions";

const editableStatuses = ["active", "trialing", "past_due", "expired"] as const;

function todayDateOnly(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
}

function addMonths(dateOnly: string, months: number): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

export function AdminSubscriptionManage({
  data,
  plans,
}: {
  data: AdminSubscriptionDetail;
  plans: AdminPlanRecord[];
}) {
  const activePlans = useMemo(
    () => plans.filter((plan) => plan.isActive).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [plans]
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function runAction(
    action: () => Promise<{ ok: true; id?: string } | { ok: false; error: string }>,
    successMessage: string
  ) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(adminActionErrorMessage(result.error));
        return;
      }
      setSuccess(successMessage);
    });
  }

  if (data.status === "none") {
    const defaultStart = todayDateOnly();
    const defaultEnd = addMonths(defaultStart, 1);
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">Criar assinatura</h2>
        <p className="mt-1 text-sm text-slate-500">
          Cadastre uma assinatura administrativa para esta organização. Sem cobrança automática.
        </p>
        {error ? (
          <div className="mt-4">
            <AdminErrorNotice message={error} />
          </div>
        ) : null}
        {success ? <SuccessNotice message={success} /> : null}
        <form
          className="mt-5 grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            runAction(
              () =>
                createAdminSubscriptionAction({
                  org_id: data.id,
                  plan_id: String(form.get("plan_id") ?? ""),
                  status: String(form.get("status") ?? "active"),
                  period_start: String(form.get("period_start") ?? ""),
                  period_end: String(form.get("period_end") ?? ""),
                  contracted_amount: optionalMoney(form.get("contracted_amount")),
                }),
              "Assinatura criada com sucesso."
            );
          }}
        >
          <Field label="Plano">
            <select
              name="plan_id"
              required
              disabled={pending || activePlans.length === 0}
              className={inputClass}
            >
              <option value="">Selecione um plano</option>
              {activePlans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} — {plan.amount} (
                  {plan.billingInterval === "monthly" ? "Mensal" : "Anual"})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status inicial">
            <select name="status" defaultValue="active" disabled={pending} className={inputClass}>
              <option value="active">{ADMIN_SUBSCRIPTION_STATUS_LABELS.active}</option>
              <option value="trialing">{ADMIN_SUBSCRIPTION_STATUS_LABELS.trialing}</option>
              <option value="past_due">{ADMIN_SUBSCRIPTION_STATUS_LABELS.past_due}</option>
            </select>
          </Field>
          <Field label="Início">
            <input
              type="date"
              name="period_start"
              required
              defaultValue={defaultStart}
              disabled={pending}
              className={inputClass}
            />
          </Field>
          <Field label="Vencimento">
            <input
              type="date"
              name="period_end"
              required
              defaultValue={defaultEnd}
              disabled={pending}
              className={inputClass}
            />
          </Field>
          <Field label="Valor contratado (opcional)">
            <input
              name="contracted_amount"
              placeholder="Usa o valor do plano se vazio"
              pattern="^(?:0|[1-9]\d{0,9})\.\d{2}$"
              disabled={pending}
              className={inputClass}
            />
          </Field>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={pending || activePlans.length === 0}
              className={primaryButtonClass}
            >
              {pending ? "Salvando..." : "Criar assinatura"}
            </button>
          </div>
        </form>
        {activePlans.length === 0 ? (
          <p className="mt-3 text-sm text-amber-700">
            Nenhum plano ativo disponível. Cadastre ou ative um plano em Planos.
          </p>
        ) : null}
      </section>
    );
  }

  if (!data.subscriptionId) return null;

  const isCancelled = data.status === "canceled" || data.status === "cancelled";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold text-slate-900">Gestão da assinatura</h2>
      <p className="mt-1 text-sm text-slate-500">
        Alterações administrativas de plano, status, período e cancelamento. Sem gateway de pagamento.
      </p>
      {error ? (
        <div className="mt-4">
          <AdminErrorNotice message={error} />
        </div>
      ) : null}
      {success ? <SuccessNotice message={success} /> : null}

      <div className="mt-5 grid gap-6 xl:grid-cols-2">
        <form
          className="grid gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (isCancelled) return;
            const form = new FormData(event.currentTarget);
            runAction(
              () =>
                updateAdminSubscriptionPlanAction({
                  subscription_id: data.subscriptionId!,
                  plan_id: String(form.get("plan_id") ?? ""),
                  contracted_amount: optionalMoney(form.get("contracted_amount")),
                }),
              "Plano atualizado."
            );
          }}
        >
          <h3 className="text-sm font-semibold text-slate-800">Alterar plano</h3>
          <Field label="Plano">
            <select
              name="plan_id"
              required
              defaultValue={data.planId ?? ""}
              disabled={pending || isCancelled || activePlans.length === 0}
              className={inputClass}
            >
              {activePlans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Novo valor (opcional)">
            <input
              name="contracted_amount"
              placeholder="Usa o valor do plano se vazio"
              pattern="^(?:0|[1-9]\d{0,9})\.\d{2}$"
              disabled={pending || isCancelled}
              className={inputClass}
            />
          </Field>
          <button type="submit" disabled={pending || isCancelled} className={secondaryButtonClass}>
            Salvar plano
          </button>
        </form>

        <form
          className="grid gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (isCancelled) return;
            const form = new FormData(event.currentTarget);
            runAction(
              () =>
                updateAdminSubscriptionStatusAction({
                  subscription_id: data.subscriptionId!,
                  status: String(form.get("status") ?? ""),
                }),
              "Status atualizado."
            );
          }}
        >
          <h3 className="text-sm font-semibold text-slate-800">Alterar status</h3>
          <Field label="Status">
            <select
              name="status"
              defaultValue={
                data.status === "canceled" || data.status === "cancelled"
                  ? "active"
                  : data.status
              }
              disabled={pending || isCancelled}
              className={inputClass}
            >
              {editableStatuses.map((status) => (
                <option key={status} value={status}>
                  {ADMIN_SUBSCRIPTION_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" disabled={pending || isCancelled} className={secondaryButtonClass}>
            Salvar status
          </button>
        </form>

        <form
          className="grid gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (isCancelled) return;
            const form = new FormData(event.currentTarget);
            runAction(
              () =>
                updateAdminSubscriptionPeriodAction({
                  subscription_id: data.subscriptionId!,
                  period_start: String(form.get("period_start") ?? ""),
                  period_end: String(form.get("period_end") ?? ""),
                }),
              "Período atualizado."
            );
          }}
        >
          <h3 className="text-sm font-semibold text-slate-800">Alterar período / vencimento</h3>
          <Field label="Início">
            <input
              type="date"
              name="period_start"
              required
              defaultValue={data.startedAt ?? ""}
              disabled={pending || isCancelled}
              className={inputClass}
            />
          </Field>
          <Field label="Vencimento">
            <input
              type="date"
              name="period_end"
              required
              defaultValue={data.expiresAt ?? ""}
              disabled={pending || isCancelled}
              className={inputClass}
            />
          </Field>
          <button type="submit" disabled={pending || isCancelled} className={secondaryButtonClass}>
            Salvar período
          </button>
        </form>

        <div className="grid gap-3 rounded-xl border border-rose-100 bg-rose-50 p-4">
          <h3 className="text-sm font-semibold text-rose-900">Cancelar assinatura</h3>
          <p className="text-sm text-rose-800">
            Define o status como cancelada e registra a data de cancelamento. Não processa estorno.
          </p>
          <button
            type="button"
            disabled={pending || isCancelled}
            className="inline-flex items-center justify-center rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => {
              if (isCancelled) return;
              const confirmed = window.confirm(
                "Confirma o cancelamento administrativo desta assinatura?"
              );
              if (!confirmed) return;
              runAction(
                () =>
                  cancelAdminSubscriptionAction({
                    subscription_id: data.subscriptionId!,
                  }),
                "Assinatura cancelada."
              );
            }}
          >
            {isCancelled ? "Já cancelada" : pending ? "Cancelando..." : "Cancelar assinatura"}
          </button>
        </div>
      </div>
    </section>
  );
}

function optionalMoney(value: FormDataEntryValue | null): string | undefined {
  const text = String(value ?? "").trim();
  return text ? text : undefined;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
      {label}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

function SuccessNotice({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
    >
      {message}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-100";

const primaryButtonClass =
  "inline-flex w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60";

const secondaryButtonClass =
  "inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60";

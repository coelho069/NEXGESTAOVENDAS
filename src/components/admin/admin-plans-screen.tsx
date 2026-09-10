"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { AdminErrorNotice } from "@/components/admin/admin-primitives";
import { adminActionErrorMessage } from "@/components/admin/admin-action-messages";
import {
  SUBSCRIPTION_BILLING_INTERVAL_LABELS,
  type AdminPlanRecord,
  type SubscriptionBillingInterval,
} from "@/lib/domain/admin-subscriptions";
import {
  createAdminPlanAction,
  deleteAdminPlanAction,
  setAdminPlanActiveAction,
  updateAdminPlanAction,
} from "@/lib/server/admin-platform-actions";
import { formatAdminAmount, formatAdminDate } from "@/components/admin/admin-primitives";

export function AdminPlansScreen({
  data,
  error,
}: {
  data: AdminPlanRecord[] | null;
  error: string | null;
}) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function runAction(
    action: () => Promise<{ ok: true; id?: string } | { ok: false; error: string }>,
    successMessage: string,
    onSuccess?: () => void
  ) {
    setActionError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setActionError(adminActionErrorMessage(result.error));
        return;
      }
      setSuccess(successMessage);
      onSuccess?.();
    });
  }

  return (
    <main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">
            Configuração da plataforma
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Planos</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            Cadastre e mantenha os planos comerciais usados nas assinaturas administrativas.
          </p>
        </div>
        <Link
          href="/admin/assinaturas"
          className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          Ir para assinaturas
        </Link>
      </header>

      {error ? <AdminErrorNotice message="Não foi possível carregar os planos." /> : null}
      {actionError ? <AdminErrorNotice message={actionError} /> : null}
      {success ? (
        <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {success}
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Plus size={18} className="text-indigo-600" aria-hidden="true" />
          <h2 className="font-semibold text-slate-900">Criar plano</h2>
        </div>
        <form
          className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            runAction(
              () =>
                createAdminPlanAction({
                  name: String(form.get("name") ?? ""),
                  description: String(form.get("description") ?? ""),
                  amount: String(form.get("amount") ?? ""),
                  billing_interval: String(form.get("billing_interval") ?? ""),
                  is_active: form.get("is_active") === "true",
                }),
              "Plano criado.",
              () => event.currentTarget.reset()
            );
          }}
        >
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Nome
            <input name="name" required maxLength={120} disabled={pending} className={inputClass} />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Valor
            <input
              name="amount"
              required
              placeholder="99.90"
              pattern="^(?:0|[1-9]\d{0,9})\.\d{2}$"
              disabled={pending}
              className={inputClass}
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Periodicidade
            <select name="billing_interval" defaultValue="monthly" disabled={pending} className={inputClass}>
              <option value="monthly">{SUBSCRIPTION_BILLING_INTERVAL_LABELS.monthly}</option>
              <option value="yearly">{SUBSCRIPTION_BILLING_INTERVAL_LABELS.yearly}</option>
            </select>
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Situação
            <select name="is_active" defaultValue="true" disabled={pending} className={inputClass}>
              <option value="true">Ativo</option>
              <option value="false">Inativo</option>
            </select>
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 md:col-span-2 xl:col-span-1">
            Descrição
            <input name="description" maxLength={2000} disabled={pending} className={inputClass} />
          </label>
          <div className="flex items-end md:col-span-2 xl:col-span-5">
            <button type="submit" disabled={pending} className={primaryButtonClass}>
              {pending ? "Salvando..." : "Criar plano"}
            </button>
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-5">
          <h2 className="font-semibold text-slate-900">Planos cadastrados</h2>
          <p className="mt-1 text-sm text-slate-500">
            {data?.length ?? 0} plano{(data?.length ?? 0) === 1 ? "" : "s"}. Planos em uso não podem ser
            excluídos — prefira desativar.
          </p>
        </div>

        {!data || data.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center px-5 py-12 text-center">
            <Building2 size={28} className="text-slate-300" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-slate-700">Nenhum plano cadastrado.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[960px] w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Plano</th>
                  <th className="px-4 py-3 font-semibold">Valor</th>
                  <th className="px-4 py-3 font-semibold">Periodicidade</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Assinaturas</th>
                  <th className="px-4 py-3 font-semibold">Atualizado</th>
                  <th className="px-5 py-3 font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody>
                {data.map((plan) => (
                  <tr key={plan.id} className="border-t border-slate-100 align-top">
                    <td className="px-5 py-4">
                      {editingId === plan.id ? (
                        <EditPlanForm
                          plan={plan}
                          pending={pending}
                          onCancel={() => setEditingId(null)}
                          onSave={(payload) =>
                            runAction(
                              () => updateAdminPlanAction(payload),
                              "Plano atualizado.",
                              () => setEditingId(null)
                            )
                          }
                        />
                      ) : (
                        <>
                          <p className="font-semibold text-slate-800">{plan.name}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {plan.description || "Sem descrição"}
                          </p>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-4 tabular-nums text-slate-600">
                      {formatAdminAmount(plan.amount)}
                    </td>
                    <td className="px-4 py-4 text-slate-600">
                      {SUBSCRIPTION_BILLING_INTERVAL_LABELS[plan.billingInterval]}
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
                          plan.isActive
                            ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                            : "bg-slate-100 text-slate-600 ring-slate-200"
                        }`}
                      >
                        {plan.isActive ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-slate-600">{plan.subscriptionCount}</td>
                    <td className="px-4 py-4 text-slate-600">{formatAdminDate(plan.updatedAt)}</td>
                    <td className="px-5 py-4">
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          disabled={pending}
                          className="text-left text-sm font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-60"
                          onClick={() => setEditingId(editingId === plan.id ? null : plan.id)}
                        >
                          {editingId === plan.id ? "Fechar edição" : "Editar"}
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          className="text-left text-sm font-semibold text-slate-700 hover:text-slate-900 disabled:opacity-60"
                          onClick={() =>
                            runAction(
                              () =>
                                setAdminPlanActiveAction({
                                  plan_id: plan.id,
                                  is_active: !plan.isActive,
                                }),
                              plan.isActive ? "Plano desativado." : "Plano ativado."
                            )
                          }
                        >
                          {plan.isActive ? "Desativar" : "Ativar"}
                        </button>
                        <button
                          type="button"
                          disabled={pending || plan.subscriptionCount > 0}
                          title={
                            plan.subscriptionCount > 0
                              ? "Plano em uso. Desative em vez de excluir."
                              : "Excluir plano"
                          }
                          className="text-left text-sm font-semibold text-rose-700 hover:text-rose-900 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => {
                            if (plan.subscriptionCount > 0) {
                              setActionError(adminActionErrorMessage("plan_in_use"));
                              return;
                            }
                            const confirmed = window.confirm(
                              `Excluir o plano "${plan.name}"? Esta ação não pode ser desfeita.`
                            );
                            if (!confirmed) return;
                            runAction(
                              () => deleteAdminPlanAction({ plan_id: plan.id }),
                              "Plano excluído."
                            );
                          }}
                        >
                          Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function EditPlanForm({
  plan,
  pending,
  onCancel,
  onSave,
}: {
  plan: AdminPlanRecord;
  pending: boolean;
  onCancel: () => void;
  onSave: (payload: {
    plan_id: string;
    name: string;
    description: string;
    amount: string;
    billing_interval: SubscriptionBillingInterval;
  }) => void;
}) {
  return (
    <form
      className="grid max-w-md gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onSave({
          plan_id: plan.id,
          name: String(form.get("name") ?? ""),
          description: String(form.get("description") ?? ""),
          amount: String(form.get("amount") ?? ""),
          billing_interval: String(form.get("billing_interval") ?? "") as SubscriptionBillingInterval,
        });
      }}
    >
      <input name="name" required defaultValue={plan.name} disabled={pending} className={inputClass} />
      <input
        name="description"
        defaultValue={plan.description}
        disabled={pending}
        className={inputClass}
      />
      <input
        name="amount"
        required
        defaultValue={plan.amount}
        pattern="^(?:0|[1-9]\d{0,9})\.\d{2}$"
        disabled={pending}
        className={inputClass}
      />
      <select
        name="billing_interval"
        defaultValue={plan.billingInterval}
        disabled={pending}
        className={inputClass}
      >
        <option value="monthly">{SUBSCRIPTION_BILLING_INTERVAL_LABELS.monthly}</option>
        <option value="yearly">{SUBSCRIPTION_BILLING_INTERVAL_LABELS.yearly}</option>
      </select>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          Salvar
        </button>
        <button type="button" disabled={pending} onClick={onCancel} className={ghostButtonClass}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

const inputClass =
  "mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-100";

const primaryButtonClass =
  "inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60";

const ghostButtonClass =
  "inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";

import Link from "next/link";
import { Search, SlidersHorizontal } from "lucide-react";
import {
  AdminDataNotice,
  AdminErrorNotice,
  PdvStatusBadge,
  SubscriptionStatusBadge,
  formatAdminAmount,
  formatAdminBillingInterval,
  formatAdminDate,
} from "@/components/admin/admin-primitives";
import {
  ADMIN_SUBSCRIPTION_STATUS_LABELS,
  ADMIN_SUBSCRIPTION_STATUSES,
  type AdminSubscriptionFilters,
  type AdminSubscriptionsPayload,
} from "@/lib/domain/admin-subscriptions";

export function AdminSubscriptionsScreen({
  data,
  error,
  filters,
}: {
  data: AdminSubscriptionsPayload | null;
  error: string | null;
  filters: AdminSubscriptionFilters;
}) {
  return (
    <main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">
            Gestão de clientes
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Assinaturas</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            Consulte o cliente, o plano e a situação do PDV com os dados disponíveis no sistema.
          </p>
        </div>
        <Link
          href="/admin"
          className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          Voltar à visão geral
        </Link>
      </header>

      {error ? (
        <AdminErrorNotice
          message={
            error === "invalid_filters"
              ? "Alguns filtros são inválidos. Revise as datas e tente novamente."
              : "Não foi possível carregar a listagem de assinaturas."
          }
        />
      ) : null}
      {data?.dataAvailabilityMessage ? <AdminDataNotice message={data.dataAvailabilityMessage} /> : null}

      <form
        method="get"
        action="/admin/assinaturas"
        className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
      >
        <div className="mb-4 flex items-center gap-2">
          <SlidersHorizontal size={18} className="text-indigo-600" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-slate-900">Filtros</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 xl:col-span-2">
            Cliente
            <span className="relative mt-1.5 block">
              <Search size={16} className="pointer-events-none absolute left-3 top-2.5 text-slate-400" aria-hidden="true" />
              <input
                name="query"
                defaultValue={filters.query ?? ""}
                placeholder="Nome ou identificador"
                className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm font-normal text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </span>
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Plano
            <select
              name="plan_id"
              defaultValue={filters.planId ?? ""}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="">Todos os planos</option>
              {(data?.plans ?? []).map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                  {plan.isActive ? "" : " (inativo)"}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Status
            <select
              name="status"
              defaultValue={filters.status ?? ""}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="">Todos os status</option>
              {ADMIN_SUBSCRIPTION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {ADMIN_SUBSCRIPTION_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Vencimento de
              <input
                type="date"
                name="expires_from"
                defaultValue={filters.expiresFrom ?? ""}
                className="mt-1.5 block w-full rounded-lg border border-slate-300 px-2 py-2 text-sm font-normal text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Até
              <input
                type="date"
                name="expires_to"
                defaultValue={filters.expiresTo ?? ""}
                className="mt-1.5 block w-full rounded-lg border border-slate-300 px-2 py-2 text-sm font-normal text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </label>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
          >
            Aplicar filtros
          </button>
          <Link href="/admin/assinaturas" className="text-sm font-semibold text-slate-500 hover:text-slate-900">
            Limpar
          </Link>
        </div>
      </form>

      {data ? (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-1 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-slate-900">Clientes e assinaturas</h2>
              <p className="mt-1 text-sm text-slate-500">
                {data.records.length} registro{data.records.length === 1 ? "" : "s"} encontrado
                {data.records.length === 1 ? "" : "s"}.
              </p>
            </div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Ordenado por vencimento
            </span>
          </div>

          {data.records.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center px-5 py-12 text-center">
              <Search size={28} className="text-slate-300" aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold text-slate-700">Nenhum registro encontrado.</p>
              <p className="mt-1 max-w-md text-sm text-slate-500">
                Revise os filtros ou cadastre uma assinatura para a organização correspondente.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[1040px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Cliente / empresa</th>
                    <th className="px-4 py-3 font-semibold">Plano</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Periodicidade</th>
                    <th className="px-4 py-3 font-semibold">Início</th>
                    <th className="px-4 py-3 font-semibold">Vencimento</th>
                    <th className="px-4 py-3 font-semibold">Valor</th>
                    <th className="px-4 py-3 font-semibold">PDV</th>
                    <th className="px-4 py-3 font-semibold">Atualizado</th>
                    <th className="px-5 py-3 font-semibold">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {data.records.map((record) => (
                    <tr key={record.id} className="border-t border-slate-100 align-middle">
                      <td className="px-5 py-4">
                        <p className="font-semibold text-slate-800">{record.clientName}</p>
                        <p className="mt-1 text-xs text-slate-500">{record.clientSlug}</p>
                      </td>
                      <td className="px-4 py-4 text-slate-600">{record.planName ?? "Sem plano"}</td>
                      <td className="px-4 py-4">
                        <SubscriptionStatusBadge status={record.status} />
                      </td>
                      <td className="px-4 py-4 text-slate-600">
                        {formatAdminBillingInterval(record.billingInterval)}
                      </td>
                      <td className="px-4 py-4 text-slate-600">{formatAdminDate(record.startedAt)}</td>
                      <td className="px-4 py-4 text-slate-600">{formatAdminDate(record.expiresAt)}</td>
                      <td className="px-4 py-4 tabular-nums text-slate-600">{formatAdminAmount(record.amount)}</td>
                      <td className="px-4 py-4">
                        <PdvStatusBadge status={record.pdvStatus} />
                      </td>
                      <td className="px-4 py-4 text-slate-600">{formatAdminDate(record.lastUpdated)}</td>
                      <td className="px-5 py-4">
                        <Link
                          href={`/admin/assinaturas/${record.id}`}
                          className="whitespace-nowrap font-semibold text-indigo-600 hover:text-indigo-800"
                        >
                          Ver detalhes
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-12 text-center text-sm text-slate-500 shadow-sm">
          A listagem administrativa está indisponível no momento.
        </div>
      )}
    </main>
  );
}

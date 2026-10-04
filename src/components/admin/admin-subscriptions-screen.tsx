import Link from "next/link";
import {
  AlertTriangle,
  Ban,
  Building2,
  CalendarClock,
  CheckCircle2,
  Search,
  SlidersHorizontal,
  UserX,
} from "lucide-react";
import {
  AdminDataNotice,
  AdminErrorNotice,
  AdminMetricCard,
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
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Gestão de clientes
          </p>
          <h1
            className="mt-2 text-3xl font-bold tracking-tight text-foreground"
            style={{ fontFamily: "var(--font-jakarta), system-ui, sans-serif" }}
          >
            Gerenciamento de Assinaturas
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Consulte clientes, planos, cobranças e a situação operacional do PDV com os dados
            disponíveis no sistema.
          </p>
        </div>
        <Link href="/admin" className="pdv-btn-ghost inline-flex items-center justify-center">
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

      {data ? (
        <section
          aria-label="Indicadores de assinaturas"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6"
        >
          <AdminMetricCard
            label="Total de clientes"
            value={String(data.overview.totalClients)}
            caption="Organizações na plataforma"
            icon={Building2}
            tone="indigo"
          />
          <AdminMetricCard
            label="Assinaturas ativas"
            value={String(data.overview.activeSubscriptions)}
            caption={`Trial: ${data.overview.trialingSubscriptions}`}
            icon={CheckCircle2}
            tone="emerald"
          />
          <AdminMetricCard
            label="Em atraso"
            value={String(data.overview.pastDueSubscriptions)}
            icon={AlertTriangle}
            tone="amber"
          />
          <AdminMetricCard
            label="Vencidas"
            value={String(data.overview.expiredSubscriptions)}
            icon={CalendarClock}
            tone="rose"
          />
          <AdminMetricCard
            label="Canceladas"
            value={String(data.overview.cancelledSubscriptions)}
            icon={Ban}
            tone="slate"
          />
          <AdminMetricCard
            label="Sem assinatura"
            value={String(data.overview.noneSubscriptions)}
            icon={UserX}
            tone="amber"
          />
        </section>
      ) : null}

      <form method="get" action="/admin/assinaturas" className="pdv-panel sm:p-5">
        <div className="mb-4 flex items-center gap-2">
          <SlidersHorizontal size={18} className="text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-foreground">Filtros</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground xl:col-span-2">
            Cliente
            <span className="relative mt-1.5 block">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-2.5 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                name="query"
                defaultValue={filters.query ?? ""}
                placeholder="Nome ou identificador"
                className="pdv-input py-2 pl-9 pr-3 text-sm font-normal"
              />
            </span>
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Plano
            <select
              name="plan_id"
              defaultValue={filters.planId ?? ""}
              className="pdv-input mt-1.5 text-sm font-normal"
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
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Status
            <select
              name="status"
              defaultValue={filters.status ?? ""}
              className="pdv-input mt-1.5 text-sm font-normal"
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
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Vencimento de
              <input
                type="date"
                name="expires_from"
                defaultValue={filters.expiresFrom ?? ""}
                className="pdv-input mt-1.5 px-2 text-sm font-normal"
              />
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Até
              <input
                type="date"
                name="expires_to"
                defaultValue={filters.expiresTo ?? ""}
                className="pdv-input mt-1.5 px-2 text-sm font-normal"
              />
            </label>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="submit" className="pdv-btn-primary">
            Aplicar filtros
          </button>
          <Link href="/admin/assinaturas" className="text-sm font-semibold text-muted-foreground hover:text-foreground">
            Limpar
          </Link>
        </div>
      </form>

      {data ? (
        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg shadow-black/20 backdrop-blur-md">
          <div className="flex flex-col gap-1 border-b border-border px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-foreground">Clientes e assinaturas</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {data.records.length} registro{data.records.length === 1 ? "" : "s"} encontrado
                {data.records.length === 1 ? "" : "s"}.
              </p>
            </div>
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Ordenado por vencimento
            </span>
          </div>

          {data.records.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center px-5 py-12 text-center">
              <Search size={28} className="text-muted-foreground/50" aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold text-foreground">Nenhum registro encontrado.</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Revise os filtros ou cadastre uma assinatura para a organização correspondente.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[1040px] w-full text-left text-sm">
                <thead className="bg-background/40 text-[11px] uppercase tracking-wide text-muted-foreground">
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
                    <tr
                      key={record.id}
                      className="border-t border-border align-middle transition-colors hover:bg-white/5"
                    >
                      <td className="px-5 py-4">
                        <p className="font-semibold text-foreground">{record.clientName}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{record.clientSlug}</p>
                      </td>
                      <td className="px-4 py-4 text-muted-foreground">{record.planName ?? "Sem plano"}</td>
                      <td className="px-4 py-4">
                        <SubscriptionStatusBadge status={record.status} />
                      </td>
                      <td className="px-4 py-4 text-muted-foreground">
                        {formatAdminBillingInterval(record.billingInterval)}
                      </td>
                      <td className="px-4 py-4 text-muted-foreground tabular-nums">
                        {formatAdminDate(record.startedAt)}
                      </td>
                      <td className="px-4 py-4 text-muted-foreground tabular-nums">
                        {formatAdminDate(record.expiresAt)}
                      </td>
                      <td className="px-4 py-4 tabular-nums text-muted-foreground">
                        {formatAdminAmount(record.amount)}
                      </td>
                      <td className="px-4 py-4">
                        <PdvStatusBadge status={record.pdvStatus} />
                      </td>
                      <td className="px-4 py-4 text-muted-foreground tabular-nums">
                        {formatAdminDate(record.lastUpdated)}
                      </td>
                      <td className="px-5 py-4">
                        <Link
                          href={`/admin/assinaturas/${record.id}`}
                          className="whitespace-nowrap font-semibold text-primary hover:text-blue-300"
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
        <div className="pdv-panel py-12 text-center text-sm text-muted-foreground">
          A listagem administrativa está indisponível no momento.
        </div>
      )}
    </main>
  );
}

import Link from "next/link";
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  Ban,
  UserX,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import {
  AdminDataNotice,
  AdminErrorNotice,
  AdminMetricCard,
  SubscriptionStatusBadge,
  formatAdminDate,
} from "@/components/admin/admin-primitives";
import type { AdminSubscriptionsPayload } from "@/lib/domain/admin-subscriptions";

export function AdminDashboardScreen({
  data,
  error,
}: {
  data: AdminSubscriptionsPayload | null;
  error: string | null;
}) {
  return (
    <main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">
            Central administrativa
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Visão geral</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            Acompanhe clientes, assinaturas e a operação dos PDVs em um único lugar.
          </p>
        </div>
        <Link
          href="/admin/assinaturas"
          className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-200 transition-colors hover:bg-indigo-700"
        >
          Ver clientes e assinaturas
        </Link>
      </header>

      {error ? <AdminErrorNotice message="Não foi possível carregar os dados administrativos." /> : null}
      {data?.dataAvailabilityMessage ? <AdminDataNotice message={data.dataAvailabilityMessage} /> : null}

      {data ? (
        <>
          <section
            aria-label="Indicadores de clientes e assinaturas"
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6"
          >
            <AdminMetricCard
              label="Total de clientes"
              value={String(data.overview.totalClients)}
              caption="Organizações da plataforma"
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
              label="Assinaturas vencidas"
              value={String(data.overview.expiredSubscriptions)}
              icon={CalendarClock}
              tone="rose"
            />
            <AdminMetricCard
              label="Assinaturas canceladas"
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

          <section className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-semibold text-slate-900">Próximos vencimentos</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Assinaturas ativas, em trial ou em atraso com vencimento conhecido.
                  </p>
                </div>
                <CalendarClock size={21} className="text-slate-300" aria-hidden="true" />
              </div>
              {data.nextExpirations.length === 0 ? (
                <div className="flex min-h-44 flex-col items-center justify-center px-5 py-10 text-center">
                  <XCircle size={28} className="text-slate-300" aria-hidden="true" />
                  <p className="mt-3 text-sm font-medium text-slate-700">Nenhum vencimento disponível.</p>
                  <p className="mt-1 max-w-md text-sm text-slate-500">
                    Cadastre assinaturas com período definido para acompanhar os vencimentos.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {data.nextExpirations.map((record) => (
                    <Link
                      key={record.id}
                      href={`/admin/assinaturas/${record.id}`}
                      className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800">{record.clientName}</p>
                        <p className="mt-1 text-xs text-slate-500">{record.planName ?? "Sem plano"}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <SubscriptionStatusBadge status={record.status} />
                        <span className="text-xs text-slate-500">{formatAdminDate(record.expiresAt)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                Escopo de acesso
              </p>
              <h2 className="mt-3 text-lg font-semibold text-slate-900">Administração segura</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Esta área usa a sessão atual e a permissão global de administrador da plataforma. Ela não
                reutiliza o papel de administrador de loja nem expõe a chave service role no navegador.
              </p>
              <div className="mt-5 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <span className="font-semibold text-slate-800">Fonte disponível:</span> organizações,
                planos, assinaturas, lojas e perfis.
              </div>
            </div>
          </section>
        </>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-12 text-center text-sm text-slate-500 shadow-sm">
          Os dados administrativos estão indisponíveis no momento.
        </div>
      )}
    </main>
  );
}

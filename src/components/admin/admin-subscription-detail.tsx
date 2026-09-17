import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  AdminDataNotice,
  AdminErrorNotice,
  SubscriptionStatusBadge,
  formatAdminSubscriptionPeriod,
} from "@/components/admin/admin-primitives";
import { AdminSubscriptionManage } from "@/components/admin/admin-subscription-manage";
import {
  formatAdminGateReason,
  type AdminPlanRecord,
  type AdminSubscriptionDetail,
} from "@/lib/domain/admin-subscriptions";

export function AdminSubscriptionDetailScreen({
  data,
  error,
  plans,
}: {
  data: AdminSubscriptionDetail | null;
  error: string | null;
  plans: AdminPlanRecord[];
}) {
  return (
    <main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-4">
        <Link
          href="/admin/assinaturas"
          className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-800"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Voltar para assinaturas
        </Link>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">
            Detalhe da assinatura
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
            {data?.clientName ?? "Assinatura"}
          </h1>
          {data ? <p className="mt-2 text-sm text-slate-500">{data.clientSlug}</p> : null}
        </div>
      </header>

      {error ? <AdminErrorNotice message="Não foi possível carregar os detalhes da assinatura." /> : null}
      {data?.status === "none" ? (
        <AdminDataNotice message="Esta organização ainda não possui uma assinatura cadastrada." />
      ) : null}

      {data ? (
        <>
          <section
            data-testid="admin-subscription-summary"
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <h2 className="text-sm font-semibold text-slate-900">Resumo da assinatura</h2>
            <p className="mt-1 text-sm text-slate-500">
              Status operacional, plano, período vigente e motivo do bloqueio de acesso ao PDV.
            </p>
            <dl className="mt-5 grid gap-5 sm:grid-cols-2">
              <DetailField
                label="Status"
                value={null}
                badge={<SubscriptionStatusBadge status={data.status} />}
              />
              <DetailField label="Plano" value={data.planName ?? "Sem plano"} />
              <DetailField
                label="Período"
                value={formatAdminSubscriptionPeriod(data.startedAt, data.expiresAt)}
              />
              <DetailField label="Motivo do gate" value={formatAdminGateReason(data)} />
            </dl>
            <div
              className={`mt-5 rounded-xl px-4 py-3 text-sm ${
                data.accessAllowed
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border border-rose-200 bg-rose-50 text-rose-900"
              }`}
              role="status"
            >
              {data.accessMessage}
            </div>
          </section>

          <AdminSubscriptionManage data={data} plans={plans} />
        </>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-12 text-center text-sm text-slate-500 shadow-sm">
          Os detalhes estão indisponíveis no momento.
        </div>
      )}
    </main>
  );
}

function DetailField({
  label,
  value,
  badge,
}: {
  label: string;
  value: string | null;
  badge?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-800">{badge ?? value ?? "N/D"}</dd>
    </div>
  );
}

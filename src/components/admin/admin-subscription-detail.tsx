import Link from "next/link";
import { ArrowLeft, Building2, CalendarClock, Clock3, Store, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  AdminDataNotice,
  AdminErrorNotice,
  PdvStatusBadge,
  SubscriptionStatusBadge,
  adminRoleLabel,
  formatAdminAmount,
  formatAdminBillingInterval,
  formatAdminDate,
} from "@/components/admin/admin-primitives";
import { AdminSubscriptionManage } from "@/components/admin/admin-subscription-manage";
import type {
  AdminPlanRecord,
  AdminSubscriptionDetail,
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
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <Link
            href="/admin/assinaturas"
            className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-800"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Voltar para assinaturas
          </Link>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">
            Detalhes do cliente
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
            {data?.clientName ?? "Detalhes da assinatura"}
          </h1>
          {data ? <p className="mt-2 text-sm text-slate-500">{data.clientSlug}</p> : null}
        </div>
        {data ? (
          <div className="flex flex-wrap items-center gap-2">
            <SubscriptionStatusBadge status={data.status} />
            <PdvStatusBadge status={data.pdvStatus} />
          </div>
        ) : null}
      </header>

      {error ? <AdminErrorNotice message="Não foi possível carregar os detalhes do cliente." /> : null}
      {data?.status === "none" ? (
        <AdminDataNotice message="Esta organização ainda não possui uma assinatura cadastrada." />
      ) : null}
      {data && data.status !== "none" ? (
        <AdminDataNotice
          message={`${data.accessAllowed ? "Acesso ao PDV liberado" : "Acesso ao PDV bloqueado"}: ${data.accessMessage}`}
        />
      ) : null}

      {data ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <DetailCard label="Plano" value={data.planName ?? "Sem plano"} icon={Building2} />
            <DetailCard label="Valor contratado" value={formatAdminAmount(data.amount)} icon={Clock3} />
            <DetailCard
              label="Periodicidade"
              value={formatAdminBillingInterval(data.billingInterval)}
              icon={CalendarClock}
            />
            <DetailCard label="Última atualização" value={formatAdminDate(data.lastUpdated)} icon={Clock3} />
          </section>

          <AdminSubscriptionManage data={data} plans={plans} />

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <SectionHeading icon={Building2} title="Dados da organização e assinatura" />
              <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                <DetailField label="Empresa" value={data.clientName} />
                <DetailField label="Identificador" value={data.clientSlug} />
                <DetailField label="Plano" value={data.planName} />
                <DetailField
                  label="Status"
                  value={null}
                  badge={<SubscriptionStatusBadge status={data.status} />}
                />
                <DetailField label="Valor" value={formatAdminAmount(data.amount)} />
                <DetailField
                  label="Periodicidade"
                  value={formatAdminBillingInterval(data.billingInterval)}
                />
                <DetailField label="Início" value={formatAdminDate(data.startedAt)} />
                <DetailField label="Vencimento" value={formatAdminDate(data.expiresAt)} />
                <DetailField label="Cancelamento" value={formatAdminDate(data.cancelledAt)} />
                <DetailField
                  label="Criação da assinatura"
                  value={formatAdminDate(data.subscriptionCreatedAt)}
                />
                <DetailField
                  label="Atualização da assinatura"
                  value={formatAdminDate(data.subscriptionUpdatedAt)}
                />
                <DetailField label="Moeda" value={data.currency} />
                <DetailField label="Fuso horário" value={data.timezone} />
                <DetailField label="ID da conta" value={data.id} mono />
                <DetailField label="ID da assinatura" value={data.subscriptionId} mono />
              </dl>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <SectionHeading icon={Store} title="Situação do PDV" />
              <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                <DetailField label="Status operacional" value={null} badge={<PdvStatusBadge status={data.pdvStatus} />} />
                <DetailField
                  label="Acesso por assinatura"
                  value={data.accessAllowed ? "Liberado" : "Bloqueado"}
                />
                <DetailField label="Motivo do acesso" value={data.accessReason} />
                <DetailField label="Lojas visíveis" value={String(data.storeCount)} />
                <DetailField label="Lojas ativas" value={String(data.activeStoreCount)} />
                <DetailField label="Usuários vinculados" value={String(data.teamMemberCount)} />
              </dl>
              <div className="mt-5 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                {data.accessMessage} O status operacional das lojas não substitui a regra server-side
                de assinatura.
              </div>
            </section>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <SectionHeading icon={Store} title="Lojas vinculadas" />
              {data.stores.length === 0 ? (
                <EmptyDetail text="Nenhuma loja disponível para este administrador." />
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[480px] text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="pb-3 font-semibold">Loja</th>
                        <th className="pb-3 font-semibold">Código</th>
                        <th className="pb-3 font-semibold">Situação</th>
                        <th className="pb-3 font-semibold">Atualização</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.stores.map((store) => (
                        <tr key={store.id} className="border-t border-slate-100">
                          <td className="py-3 font-medium text-slate-800">{store.name}</td>
                          <td className="py-3 text-slate-500">{store.code}</td>
                          <td className="py-3 text-slate-600">{store.isActive ? "Ativa" : "Inativa"}</td>
                          <td className="py-3 text-slate-500">{formatAdminDate(store.lastUpdated)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <SectionHeading icon={Users} title="Contatos vinculados" />
              {data.contacts.length === 0 ? (
                <EmptyDetail text="Nenhum contato disponível para esta conta." />
              ) : (
                <div className="mt-4 space-y-3">
                  {data.contacts.map((contact) => (
                    <div key={contact.id} className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800">{contact.fullName}</p>
                        <p className="mt-1 truncate text-xs text-slate-500">{contact.email}</p>
                      </div>
                      <span className="shrink-0 text-xs font-medium text-slate-500">{adminRoleLabel(contact.role)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-12 text-center text-sm text-slate-500 shadow-sm">
          Os detalhes estão indisponíveis no momento.
        </div>
      )}
    </main>
  );
}

function SectionHeading({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
        <Icon size={18} aria-hidden="true" />
      </span>
      <h2 className="font-semibold text-slate-900">{title}</h2>
    </div>
  );
}

function DetailCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <Icon size={18} className="text-slate-400" aria-hidden="true" />
      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-base font-semibold text-slate-800">{value}</p>
    </article>
  );
}

function DetailField({
  label,
  value,
  badge,
  mono = false,
}: {
  label: string;
  value: string | null;
  badge?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`mt-1 text-sm text-slate-700 ${mono ? "break-all font-mono text-xs" : ""}`}>
        {badge ?? value ?? "N/D"}
      </dd>
    </div>
  );
}

function EmptyDetail({ text }: { text: string }) {
  return <p className="mt-5 rounded-xl bg-slate-50 px-4 py-6 text-sm text-slate-500">{text}</p>;
}

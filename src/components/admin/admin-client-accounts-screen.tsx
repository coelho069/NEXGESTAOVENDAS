"use client";

/**
 * Administrative client-accounts screen.
 *
 * Reuses the admin visual language (dark glass panels, pdv-* primitives,
 * Jakarta/Inter) and the existing server-action + revalidation pattern. All
 * authorization happens server-side: this component only renders state.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Mail,
  MailWarning,
  RefreshCw,
  Search,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import {
  AdminDataNotice,
  AdminErrorNotice,
  AdminMetricCard,
  SubscriptionStatusBadge,
  formatAdminDate,
} from "@/components/admin/admin-primitives";
import {
  createAdminClientAccountAction,
  resendAdminClientAccountInviteAction,
  setAdminClientAccountSuspendedAction,
} from "@/lib/server/admin-client-account-actions";
import {
  ADMIN_CLIENT_ACCOUNT_SUBSCRIPTION_FILTERS,
  CLIENT_ACCOUNT_STATUS_LABELS,
  CLIENT_ACCOUNT_STATUSES,
  describeClientAccountState,
  type AdminClientAccountFilters,
  type AdminClientAccountPayload,
  type AdminClientAccountRecord,
} from "@/lib/domain/admin-client-accounts";
import {
  ADMIN_SUBSCRIPTION_STATUS_LABELS,
  type AdminSubscriptionStatus,
} from "@/lib/domain/admin-subscriptions";

const CLIENT_ACCOUNT_ERROR_MESSAGES: Record<string, string> = {
  forbidden: "Você não tem permissão de administrador para esta operação.",
  rate_limited: "Limite de convites por hora atingido. Tente novamente mais tarde.",
  validation_failed: "Revise os campos informados: some dados são inválidos.",
  email_already_exists: "Já existe uma conta com este e-mail.",
  organization_not_found: "Organização não encontrada.",
  subscription_not_found: "Assinatura não encontrada.",
  subscription_org_mismatch: "A assinatura selecionada pertence a outra organização.",
  gmail_not_configured:
    "A conta foi criada, mas o envio por e-mail está indisponível. Reenvie o convite assim que o Gmail for configurado.",
  account_create_failed: "Não foi possível criar a conta. Tente novamente.",
  invite_generation_failed: "Não foi possível gerar o convite de ativação.",
  invite_send_failed:
    "A conta foi criada, mas o e-mail não pôde ser enviado. Use “Reenviar convite” para tentar de novo.",
  account_not_found: "Conta não encontrada.",
  account_not_resendable:
    "Esta conta já foi ativada ou está suspensa e não aceita novos convites.",
  suspension_not_supported: "A conta já está neste estado.",
  service_role_unavailable: "Serviço de provisionamento indisponível no momento.",
  unavailable: "Não foi possível concluir a operação. Tente novamente.",
};

function accountErrorMessage(error: string): string {
  return CLIENT_ACCOUNT_ERROR_MESSAGES[error] ?? CLIENT_ACCOUNT_ERROR_MESSAGES.unavailable;
}

function AccountStateBadge({ record }: { record: AdminClientAccountRecord }) {
  const summary = describeClientAccountState({
    status: record.status,
    subscriptionStatus: record.subscriptionStatus,
    inviteExpiresAt: record.inviteExpiresAt,
  });

  const classes: Record<string, string> = {
    created: "border-border bg-card text-muted-foreground",
    invite_pending: "border-primary/35 bg-primary/10 text-blue-200",
    invite_sent: "border-primary/35 bg-primary/10 text-blue-200",
    invite_expired: "border-warning/35 bg-warning/10 text-amber-200",
    activated: "border-success/35 bg-success/10 text-emerald-200",
    invite_failed: "border-destructive/35 bg-destructive/10 text-red-200",
    suspended: "border-destructive/35 bg-destructive/10 text-red-200",
  };

  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${
        classes[summary.status] ?? classes.created
      }`}
    >
      {summary.statusLabel}
    </span>
  );
}

export function AdminClientAccountsScreen({
  data,
  error,
  filters,
}: {
  data: AdminClientAccountPayload | null;
  error: string | null;
  filters: AdminClientAccountFilters;
}) {
  const router = useRouter();
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function runAction(
    action: () => Promise<{ ok: true } | { ok: false; error: string }>,
    successMessage: string
  ) {
    setActionError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setActionError(accountErrorMessage(result.error));
        return;
      }
      setSuccess(successMessage);
      router.refresh();
    });
  }

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
            Contas de clientes
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Após a confirmação do pagamento, o acesso é provisionado automaticamente e o cliente
            recebe um e-mail com link seguro para definir a senha. Use esta tela para consultar o
            status, reenviar o acesso quando necessário ou provisionar manualmente em casos excepcionais.
          </p>
        </div>
        <Link href="/admin/assinaturas" className="pdv-btn-ghost inline-flex justify-center">
          Ver assinaturas
        </Link>
      </header>

      {error ? (
        <AdminErrorNotice
          message={
            error === "forbidden_admin"
              ? "Você não tem permissão de administrador para acessar esta área."
              : "Não foi possível carregar as contas de clientes."
          }
        />
      ) : null}
      {actionError ? <AdminErrorNotice message={actionError} /> : null}
      {success ? (
        <div
          role="status"
          className="rounded-lg border border-success bg-success px-4 py-3 text-sm text-emerald-100"
          style={{ backgroundColor: "color-mix(in srgb, var(--success) 12%, transparent)" }}
        >
          {success}
        </div>
      ) : null}

      {data ? (
        <section
          aria-label="Indicadores de contas"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6"
        >
          <AdminMetricCard
            label="Total de contas"
            value={String(data.overview.totalAccounts)}
            caption="Clientes provisionados"
            icon={UserPlus}
            tone="indigo"
          />
          <AdminMetricCard
            label="Acessos pendentes"
            value={String(data.overview.pendingInvites)}
            caption={`Expirando em 24h: ${data.overview.expiringInvites}`}
            icon={Mail}
            tone="slate"
          />
          <AdminMetricCard
            label="Contas ativas"
            value={String(data.overview.activatedAccounts)}
            icon={CheckCircle2}
            tone="emerald"
          />
          <AdminMetricCard
            label="Falhas de envio"
            value={String(data.overview.failedInvites)}
            icon={MailWarning}
            tone="rose"
          />
          <AdminMetricCard
            label="Suspensas"
            value={String(data.overview.suspendedAccounts)}
            icon={Ban}
            tone="amber"
          />
          <AdminMetricCard
            label="Organizações"
            value={String(data.organizations.length)}
            caption="Elegíveis para vínculo"
            icon={ShieldCheck}
            tone="slate"
          />
        </section>
      ) : null}

      {data ? (
        <>
          <CreateAccountForm organizations={data.organizations} pending={pending} onCreate={runAction} />
          <AccountsTable
            data={data}
            eventsByAccountId={data.eventsByAccountId}
            filters={filters}
            pending={pending}
            onAction={runAction}
          />
        </>
      ) : !error ? (
        <div className="pdv-panel py-12 text-center text-sm text-muted-foreground">
          A listagem de contas está indisponível no momento.
        </div>
      ) : null}
    </main>
  );
}

type RunAction = (
  action: () => Promise<{ ok: true } | { ok: false; error: string }>,
  successMessage: string
) => void;

function CreateAccountForm({
  organizations,
  pending,
  onCreate,
}: {
  organizations: AdminClientAccountPayload["organizations"];
  pending: boolean;
  onCreate: RunAction;
}) {
  return (
    <section aria-labelledby="create-account-heading" className="pdv-panel">
      <div className="flex items-center gap-2">
        <UserPlus size={18} className="text-primary" aria-hidden="true" />
        <h2 id="create-account-heading" className="font-semibold text-foreground">
          Provisionamento manual (exceção)
        </h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        O fluxo normal é automático após a compra. Use apenas quando o cliente não foi provisionado
        pelo webhook. O e-mail contém um link seguro para definir a senha — nunca uma senha em texto.
      </p>

      <form
        className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const subscriptionId = String(form.get("subscription_id") ?? "").trim();
          onCreate(
            () =>
              createAdminClientAccountAction({
                full_name: String(form.get("full_name") ?? ""),
                email: String(form.get("email") ?? ""),
                company_name: String(form.get("company_name") ?? ""),
                org_id: String(form.get("org_id") ?? ""),
                subscription_id: subscriptionId ? subscriptionId : undefined,
                send_invite: true,
              }),
            "Conta provisionada e e-mail de acesso enviado."
          );
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-foreground">Nome completo *</span>
          <input
            name="full_name"
            required
            maxLength={200}
            autoComplete="off"
            disabled={pending}
            className="pdv-input"
            placeholder="Maria Souza"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-foreground">E-mail *</span>
          <input
            name="email"
            type="email"
            required
            maxLength={320}
            autoComplete="off"
            disabled={pending}
            className="pdv-input"
            placeholder="maria@empresa.com.br"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-foreground">Empresa / loja</span>
          <input
            name="company_name"
            maxLength={200}
            autoComplete="off"
            disabled={pending}
            className="pdv-input"
            placeholder="Souza Varejo"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-foreground">Organização (assinatura) *</span>
          <select name="org_id" required defaultValue="" disabled={pending} className="pdv-input">
            <option value="" disabled>
              Selecione a organização
            </option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
                {organization.planName ? ` — ${organization.planName}` : " — sem plano"}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-foreground">Assinatura</span>
          <select name="subscription_id" defaultValue="" disabled={pending} className="pdv-input">
            <option value="">Vincular à assinatura da organização</option>
            {organizations
              .filter((organization) => organization.subscriptionId)
              .map((organization) => (
                <option key={organization.id} value={organization.subscriptionId ?? ""}>
                  {organization.name}
                </option>
              ))}
          </select>
          <span className="text-xs text-muted-foreground">
            Opcional. Se não informado, usa a assinatura ativa da organização.
          </span>
        </label>

        <div className="flex items-end">
          <button type="submit" disabled={pending} className="pdv-btn-primary w-full">
            {pending ? "Processando..." : "Provisionar e enviar acesso"}
          </button>
        </div>
      </form>

      {organizations.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Todas as organizações já possuem conta. Cadastre a organização em{" "}
          <Link href="/admin/assinaturas" className="text-primary hover:underline">
            Clientes e assinaturas
          </Link>
          .
        </p>
      ) : null}
    </section>
  );
}

function AccountsTable({
  data,
  eventsByAccountId,
  filters,
  pending,
  onAction,
}: {
  data: AdminClientAccountPayload;
  eventsByAccountId: AdminClientAccountPayload["eventsByAccountId"];
  filters: AdminClientAccountFilters;
  pending: boolean;
  onAction: RunAction;
}) {
  const [expandedAccountId, setExpandedAccountId] = useState<string | null>(null);
  const searchParams = new URLSearchParams();
  if (filters.query) searchParams.set("query", filters.query);
  if (filters.status) searchParams.set("status", filters.status);
  if (filters.subscriptionStatus) {
    searchParams.set("subscription_status", filters.subscriptionStatus);
  }
  const queryString = searchParams.toString();

  return (
    <section aria-label="Contas cadastradas" className="pdv-panel">
      <form
        method="get"
        className="flex flex-col gap-3 lg:flex-row lg:items-end"
        aria-label="Filtros de contas"
      >
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          <span className="font-semibold text-foreground">Pesquisar</span>
          <span className="relative">
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              name="query"
              defaultValue={filters.query ?? ""}
              maxLength={200}
              placeholder="Nome, e-mail, empresa ou loja"
              className="pdv-input pl-9"
            />
          </span>
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-foreground">Estado da conta</span>
          <select name="status" defaultValue={filters.status ?? ""} className="pdv-input">
            <option value="">Todos</option>
            {CLIENT_ACCOUNT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {CLIENT_ACCOUNT_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-foreground">Assinatura</span>
          <select name="subscription_status" defaultValue={filters.subscriptionStatus ?? ""} className="pdv-input">
            <option value="">Todas</option>
            {ADMIN_CLIENT_ACCOUNT_SUBSCRIPTION_FILTERS.map((status) => (
              <option key={status} value={status}>
                {ADMIN_SUBSCRIPTION_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>

        <div className="flex gap-2">
          <button type="submit" className="pdv-btn-ghost">
            Filtrar
          </button>
          {queryString ? (
            <Link href="/admin/clientes/contas" className="pdv-btn-ghost">
              Limpar
            </Link>
          ) : null}
        </div>
      </form>

      <div className="mt-4 overflow-x-auto">
        {data.records.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma conta encontrada com os filtros aplicados.
          </p>
        ) : (
          <table className="min-w-[1080px] w-full text-left text-sm">
            <thead className="bg-background/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-semibold">Cliente</th>
                <th className="px-4 py-3 font-semibold">Organização</th>
                <th className="px-4 py-3 font-semibold">Plano</th>
                <th className="px-4 py-3 font-semibold">Conta</th>
                <th className="px-4 py-3 font-semibold">Assinatura</th>
                <th className="px-4 py-3 font-semibold">Criada</th>
                <th className="px-4 py-3 font-semibold">E-mail de acesso</th>
                <th className="px-4 py-3 font-semibold">Ativação</th>
                <th className="px-5 py-3 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {data.records.map((record) => {
                const summary = describeClientAccountState({
                  status: record.status,
                  subscriptionStatus: record.subscriptionStatus,
                  inviteExpiresAt: record.inviteExpiresAt,
                });
                const events = eventsByAccountId[record.id] ?? [];
                const expanded = expandedAccountId === record.id;
                return (
                  <>
                  <tr key={record.id} className="border-t border-border align-middle hover:bg-white/5">
                    <td className="px-5 py-4">
                      <p className="font-semibold text-foreground">{record.fullName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{record.email}</p>
                      {record.companyName ? (
                        <p className="mt-1 text-xs text-muted-foreground">{record.companyName}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-4 text-muted-foreground">{record.organizationName}</td>
                    <td className="px-4 py-4 text-muted-foreground">{record.planName ?? "Sem plano"}</td>
                    <td className="px-4 py-4">
                      <AccountStateBadge record={record} />
                      {record.lastError ? (
                        <p className="mt-1 text-xs text-red-300">
                          <AlertTriangle size={12} aria-hidden="true" className="mr-1 inline" />
                          Falha registrada
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-4">
                      {record.subscriptionStatus ? (
                        <SubscriptionStatusBadge status={record.subscriptionStatus} />
                      ) : (
                        <span className="text-xs text-muted-foreground">Sem assinatura</span>
                      )}
                    </td>
                    <td className="px-4 py-4 tabular-nums text-muted-foreground">
                      {formatAdminDate(record.createdAt)}
                    </td>
                    <td className="px-4 py-4 tabular-nums text-muted-foreground">
                      {record.inviteSentAt ? formatAdminDate(record.inviteSentAt) : "—"}
                      {record.inviteExpiresAt && summary.status === "invite_sent" ? (
                        <p className="mt-1 text-xs text-amber-300">
                          Expira {formatAdminDate(record.inviteExpiresAt)}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-4 tabular-nums text-muted-foreground">
                      {record.activatedAt ? formatAdminDate(record.activatedAt) : "—"}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-2">
                        {summary.canResend ? (
                          <button
                            type="button"
                            disabled={pending}
                            className="pdv-btn-ghost inline-flex items-center gap-1.5 text-xs"
                            onClick={() => {
                              const confirmed = window.confirm(
                                `Reenviar o e-mail de acesso para ${record.email}? O link anterior deixa de funcionar.`
                              );
                              if (!confirmed) return;
                              onAction(
                                () =>
                                  resendAdminClientAccountInviteAction({
                                    client_account_id: record.id,
                                  }),
                                "E-mail de acesso reenviado."
                              );
                            }}
                          >
                            <RefreshCw size={13} aria-hidden="true" />
                            Reenviar acesso
                          </button>
                        ) : null}

                        {summary.canSuspend ? (
                          <button
                            type="button"
                            disabled={pending}
                            className="pdv-btn-ghost inline-flex items-center gap-1.5 text-xs"
                            onClick={() => {
                              const confirmed = window.confirm(
                                `Suspender o acesso de ${record.email}? O cliente não conseguirá entrar até a reativação. A assinatura não é alterada.`
                              );
                              if (!confirmed) return;
                              onAction(
                                () =>
                                  setAdminClientAccountSuspendedAction({
                                    client_account_id: record.id,
                                    suspended: true,
                                  }),
                                "Acesso suspenso."
                              );
                            }}
                          >
                            <Ban size={13} aria-hidden="true" />
                            Suspender
                          </button>
                        ) : null}

                        {summary.canReactivate ? (
                          <button
                            type="button"
                            disabled={pending}
                            className="pdv-btn-ghost inline-flex items-center gap-1.5 text-xs"
                            onClick={() => {
                              const confirmed = window.confirm(
                                `Reativar o acesso de ${record.email}?`
                              );
                              if (!confirmed) return;
                              onAction(
                                () =>
                                  setAdminClientAccountSuspendedAction({
                                    client_account_id: record.id,
                                    suspended: false,
                                  }),
                                "Acesso reativado."
                              );
                            }}
                          >
                            <ShieldCheck size={13} aria-hidden="true" />
                            Reativar
                          </button>
                        ) : null}

                        {record.subscriptionId ? (
                          <Link
                            href={`/admin/assinaturas/${record.organizationId}`}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-blue-300"
                          >
                            Ver assinatura
                          </Link>
                        ) : null}

                        {events.length > 0 ? (
                          <button
                            type="button"
                            className="pdv-btn-ghost inline-flex items-center gap-1.5 text-xs"
                            onClick={() =>
                              setExpandedAccountId(expanded ? null : record.id)
                            }
                          >
                            {expanded ? "Ocultar histórico" : `Histórico (${events.length})`}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {expanded ? (
                    <tr key={`${record.id}-events`} className="border-t border-border bg-background/30">
                      <td colSpan={9} className="px-5 py-4">
                        <ul className="space-y-2 text-xs text-muted-foreground">
                          {events.map((event) => (
                            <li key={event.id} className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-foreground">{event.eventLabel}</span>
                              <span className="tabular-nums">{formatAdminDate(event.createdAt)}</span>
                              {event.errorCode ? (
                                <span className="text-red-300">({event.errorCode})</span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ) : null}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

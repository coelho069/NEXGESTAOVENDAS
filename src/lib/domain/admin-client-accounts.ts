// ---------------------------------------------------------------------------
// Platform ADM — client accounts & Gmail invitations.
//
// Pure domain helpers (no I/O, no env access) so the whole lifecycle — state
// machine, filters, invitation e-mail rendering — is deterministic and unit
// testable without Supabase, Gmail or a browser.
//
// Three independent states are modelled on purpose and never conflated:
//   1. auth state       -> Supabase auth.users (email_confirmed_at, banned)
//   2. invitation state -> CLIENT_ACCOUNT_STATUSES below
//   3. financial state  -> subscriptions.status (owned by the billing domain)
// ---------------------------------------------------------------------------
import {
  ADMIN_SUBSCRIPTION_STATUSES,
  type AdminPlanRecord,
  type AdminSubscriptionStatus,
} from "@/lib/domain/admin-subscriptions";

export const CLIENT_ACCOUNT_STATUSES = [
  "created",
  "invite_pending",
  "invite_sent",
  "invite_expired",
  "activated",
  "invite_failed",
  "suspended",
] as const;

export type ClientAccountStatus = (typeof CLIENT_ACCOUNT_STATUSES)[number];

export const CLIENT_ACCOUNT_STATUS_LABELS: Record<ClientAccountStatus, string> = {
  created: "Conta provisionada",
  invite_pending: "Acesso pendente",
  invite_sent: "Acesso enviado",
  invite_expired: "Link expirado",
  activated: "Senha definida",
  invite_failed: "Falha no envio",
  suspended: "Conta suspensa",
};

/** Statuses whose access e-mail can be re-sent by an admin. */
export const RESENDABLE_CLIENT_ACCOUNT_STATUSES: readonly ClientAccountStatus[] = [
  "created",
  "invite_pending",
  "invite_sent",
  "invite_expired",
  "invite_failed",
];

/** Financial statuses offered as a filter, mirroring the subscriptions screen. */
export const ADMIN_CLIENT_ACCOUNT_SUBSCRIPTION_FILTERS = [
  ...ADMIN_SUBSCRIPTION_STATUSES,
  "none",
] as const;

export type AdminClientAccountSubscriptionFilter =
  (typeof ADMIN_CLIENT_ACCOUNT_SUBSCRIPTION_FILTERS)[number];

export function isClientAccountStatus(value: unknown): value is ClientAccountStatus {
  return (
    typeof value === "string" && (CLIENT_ACCOUNT_STATUSES as readonly string[]).includes(value)
  );
}

export function isResendableClientAccountStatus(status: ClientAccountStatus): boolean {
  return RESENDABLE_CLIENT_ACCOUNT_STATUSES.includes(status);
}

/** Suspension is only meaningful once a login exists. */
export function canSuspendClientAccount(status: ClientAccountStatus): boolean {
  return status !== "suspended";
}

export function canReactivateClientAccount(status: ClientAccountStatus): boolean {
  return status === "suspended";
}

export type ClientAccountFinancialState =
  | "no_subscription"
  | "active"
  | "trialing"
  | "past_due"
  | "expired"
  | "canceled";

/** Read-only projection of the subscription status. Never written by this module. */
export function describeFinancialState(
  status: AdminSubscriptionStatus | null
): ClientAccountFinancialState {
  if (!status || status === "none") return "no_subscription";
  if (status === "cancelled") return "canceled";
  return status;
}

export type ClientAccountStateSummary = {
  status: ClientAccountStatus;
  statusLabel: string;
  financialState: ClientAccountFinancialState;
  canResend: boolean;
  canSuspend: boolean;
  canReactivate: boolean;
  inviteExpiredByClock: boolean;
};

/**
 * Effective state of an account. The persisted `status` column can still say
 * `invite_sent` while the invitation window has already closed, so expiry is
 * derived from the clock instead of trusting a stale column.
 */
export function describeClientAccountState(input: {
  status: ClientAccountStatus;
  subscriptionStatus: AdminSubscriptionStatus | null;
  inviteExpiresAt: string | null;
  now?: number;
}): ClientAccountStateSummary {
  const now = input.now ?? Date.now();
  const expiresAt = input.inviteExpiresAt ? new Date(input.inviteExpiresAt).getTime() : null;
  const expiredByClock =
    input.status === "invite_sent" &&
    expiresAt !== null &&
    Number.isFinite(expiresAt) &&
    expiresAt <= now;

  const effectiveStatus: ClientAccountStatus = expiredByClock ? "invite_expired" : input.status;

  return {
    status: effectiveStatus,
    statusLabel: CLIENT_ACCOUNT_STATUS_LABELS[effectiveStatus],
    financialState: describeFinancialState(input.subscriptionStatus),
    canResend: isResendableClientAccountStatus(effectiveStatus),
    canSuspend: canSuspendClientAccount(effectiveStatus),
    canReactivate: canReactivateClientAccount(effectiveStatus),
    inviteExpiredByClock: expiredByClock,
  };
}

export const INVITE_EXPIRY_WARNING_MS = 24 * 60 * 60 * 1000; // warn when < 24h remain

export const CLIENT_ACCOUNT_EVENT_LABELS: Record<string, string> = {
  account_created: "Conta provisionada",
  invite_sent: "E-mail de acesso enviado",
  invite_resent: "E-mail de acesso reenviado",
  invite_failed: "Falha no envio do e-mail",
  account_activated: "Senha definida / conta ativada",
  account_suspended: "Acesso suspenso",
  account_reactivated: "Acesso reativado",
};

export type AdminClientAccountEventRecord = {
  id: string;
  clientAccountId: string;
  eventType: string;
  eventLabel: string;
  errorCode: string;
  createdAt: string;
};

export type AdminClientAccountRecord = {
  id: string;
  userId: string | null;
  email: string;
  fullName: string;
  companyName: string;
  organizationId: string;
  organizationName: string;
  subscriptionId: string | null;
  planName: string | null;
  status: ClientAccountStatus;
  lastError: string;
  inviteSentAt: string | null;
  inviteExpiresAt: string | null;
  activatedAt: string | null;
  suspendedAt: string | null;
  createdAt: string;
  updatedAt: string;
  subscriptionStatus: AdminSubscriptionStatus | null;
  /** Auth state read-only projection — never drives invitation state. */
  emailConfirmed: boolean;
};

export type AdminClientAccountFilters = {
  query?: string;
  status?: ClientAccountStatus;
  subscriptionStatus?: AdminSubscriptionStatus;
};

export type AdminClientAccountOverview = {
  totalAccounts: number;
  pendingInvites: number;
  activatedAccounts: number;
  failedInvites: number;
  suspendedAccounts: number;
  expiringInvites: number;
};

export type AdminClientAccountOrganizationOption = {
  id: string;
  name: string;
  subscriptionId: string | null;
  planId: string | null;
  planName: string | null;
  subscriptionStatus: AdminSubscriptionStatus | null;
};

export type AdminClientAccountPayload = {
  records: AdminClientAccountRecord[];
  eventsByAccountId: Record<string, AdminClientAccountEventRecord[]>;
  overview: AdminClientAccountOverview;
  plans: AdminPlanRecord[];
  organizations: AdminClientAccountOrganizationOption[];
  dataAvailable: boolean;
  dataAvailabilityMessage: string | null;
};

export const ADMIN_CLIENT_ACCOUNT_FILTER_QUERY_MAX = 200;

export function normalizeAccountEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function filterAdminClientAccountRecords(
  records: readonly AdminClientAccountRecord[],
  filters: AdminClientAccountFilters,
  now: number = Date.now()
): AdminClientAccountRecord[] {
  const query = filters.query?.trim().toLocaleLowerCase("pt-BR") ?? "";

  return records
    .filter((record) => {
      if (query) {
        const haystack =
          `${record.fullName} ${record.email} ${record.companyName} ${record.organizationName}`.toLocaleLowerCase(
            "pt-BR"
          );
        if (!haystack.includes(query)) return false;
      }
      if (filters.status) {
        // The stored status may be stale while the invite window is open; the
        // filter must agree with what the row renders.
        const effective = describeClientAccountState({
          status: record.status,
          subscriptionStatus: record.subscriptionStatus,
          inviteExpiresAt: record.inviteExpiresAt,
          now,
        }).status;
        if (effective !== filters.status) return false;
      }
      if (filters.subscriptionStatus && record.subscriptionStatus !== filters.subscriptionStatus) {
        return false;
      }
      return true;
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function buildAdminClientAccountOverview(
  records: readonly AdminClientAccountRecord[],
  now: number = Date.now()
): AdminClientAccountOverview {
  const summaries = records.map((record) =>
    describeClientAccountState({
      status: record.status,
      subscriptionStatus: record.subscriptionStatus,
      inviteExpiresAt: record.inviteExpiresAt,
      now,
    })
  );

  return {
    totalAccounts: records.length,
    pendingInvites: summaries.filter(
      (summary) => summary.status === "invite_sent" || summary.status === "invite_pending"
    ).length,
    activatedAccounts: summaries.filter((summary) => summary.status === "activated").length,
    failedInvites: summaries.filter((summary) => summary.status === "invite_failed").length,
    suspendedAccounts: summaries.filter((summary) => summary.status === "suspended").length,
    expiringInvites: records.filter(
      (record, index) =>
        summaries[index].status === "invite_sent" &&
        !!record.inviteExpiresAt &&
        new Date(record.inviteExpiresAt).getTime() - now <= INVITE_EXPIRY_WARNING_MS
    ).length,
  };
}

// ---------------------------------------------------------------------------
// Invitation e-mail content (pt-BR)
//
// The only sensitive value rendered here is the single-use activation link
// produced by the Supabase admin generateLink call. No password, no token in
// clear text, no financial data. Both HTML and text variants are generated
// from the same input so they can never drift.
// ---------------------------------------------------------------------------

export const ACCOUNT_INVITE_EMAIL_SUBJECT = "Seu acesso ao NEXGESTAOVENDAS está pronto";

export type AccountInviteEmailContent = {
  subject: string;
  html: string;
  text: string;
};

/** Escapes every interpolated value: the template never trusts admin input. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Only absolute https origins are accepted, so a hostile APP_ORIGIN cannot
 * downgrade the activation link to plaintext http or inject a foreign host.
 */
export function normalizeActivationOrigin(origin: string): string {
  const trimmed = origin.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("activation_origin_invalid");
  }
  if (parsed.protocol !== "https:") throw new Error("activation_origin_must_be_https");
  if (parsed.username || parsed.password) throw new Error("activation_origin_has_credentials");
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

export function buildAccountInviteEmailContent(input: {
  fullName: string;
  email: string;
  companyName?: string | null;
  planName?: string | null;
  activationUrl: string;
  expiresAt: string | null;
  supportEmail?: string | null;
  locale?: string;
}): AccountInviteEmailContent {
  const url = new URL(input.activationUrl);
  if (url.protocol !== "https:") throw new Error("activation_url_must_be_https");

  const safeName = escapeHtml(input.fullName.trim());
  const safeEmail = escapeHtml(input.email.trim());
  const safeCompany = escapeHtml((input.companyName ?? "").trim());
  const safePlan = escapeHtml((input.planName ?? "").trim());
  const safeLink = escapeHtml(url.toString());
  const safeSupportEmail = escapeHtml((input.supportEmail ?? "").trim());
  const locale = input.locale ?? "pt-BR";

  const firstName = input.fullName.trim().split(/\s+/)[0] ?? input.fullName.trim();
  const safeFirstName = escapeHtml(firstName);

  const validity =
    input.expiresAt
      ? `Este convite é válido até ${new Intl.DateTimeFormat(locale, {
          dateStyle: "long",
          timeStyle: "short",
          timeZone: "America/Sao_Paulo",
        }).format(new Date(input.expiresAt))}.`
      : "Este convite tem prazo de validade. Se ele expirar, peça um novo convite ao suporte.";

  const text = [
    `Olá, ${firstName}!`,
    "",
    "Sua conta no NEXGESTAOVENDAS foi criada e o acesso já está liberado para você.",
    safeCompany ? `Empresa: ${safeCompany}` : "",
    safePlan ? `Plano contratado: ${safePlan}` : "",
    "",
    "Para ativar o acesso e definir sua senha, acesse o link abaixo:",
    url.toString(),
    "",
    validity,
    "",
    "Segurança: não compartilhe este link com terceiros. Ele é pessoal e permite",
    "definir sua senha. Se você não solicitou este acesso, ignore esta mensagem.",
    safeSupportEmail ? `Dúvidas? Fale com o suporte: ${safeSupportEmail}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${ACCOUNT_INVITE_EMAIL_SUBJECT}</title>
  </head>
  <body style="margin:0;padding:0;background:#0B0F19;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0F19;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111827;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 8px 32px;">
                <p style="margin:0;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#2563EB;font-weight:700;">NEXGESTAOVENDAS</p>
                <h1 style="margin:10px 0 0 0;font-size:22px;line-height:1.3;color:#F1F5F9;font-family:'Plus Jakarta Sans','Inter',sans-serif;">Seu acesso está pronto</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 32px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#E2E8F0;">Olá, ${safeFirstName}!</p>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#E2E8F0;">
                  Sua conta foi criada e o acesso ao NEXGESTAOVENDAS está liberado para você.
                </p>
                ${
                  safeCompany
                    ? `<p style="margin:0 0 8px 0;font-size:14px;line-height:1.6;color:#94A3B8;">Empresa: <strong style="color:#F1F5F9;">${safeCompany}</strong></p>`
                    : ""
                }
                ${
                  safePlan
                    ? `<p style="margin:0 0 8px 0;font-size:14px;line-height:1.6;color:#94A3B8;">Plano contratado: <strong style="color:#F1F5F9;">${safePlan}</strong></p>`
                    : ""
                }
                <p style="margin:24px 0 0 0;">
                  <a href="${safeLink}" style="display:inline-block;background:#2563EB;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:600;padding:13px 24px;border-radius:12px;">Ativar acesso e definir senha</a>
                </p>
                <p style="margin:20px 0 0 0;font-size:13px;line-height:1.6;color:#94A3B8;">
                  Se o botão não funcionar, copie e cole este endereço no seu navegador:<br />
                  <a href="${safeLink}" style="color:#2563EB;word-break:break-all;">${safeLink}</a>
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;border:1px solid rgba(16,185,129,0.35);background:rgba(16,185,129,0.10);border-radius:12px;">
                  <tr><td style="padding:14px 16px;font-size:13px;line-height:1.6;color:#A7F3D0;">${escapeHtml(validity)}</td></tr>
                </table>
                <p style="margin:20px 0 0 0;font-size:13px;line-height:1.6;color:#FCA5A5;">
                  <strong>Segurança:</strong> não compartilhe este link. Ele é pessoal e permite definir sua senha.
                </p>
                ${
                  safeSupportEmail
                    ? `<p style="margin:12px 0 0 0;font-size:13px;line-height:1.6;color:#94A3B8;">Dúvidas? Fale com o suporte: <a href="mailto:${safeSupportEmail}" style="color:#2563EB;">${safeSupportEmail}</a></p>`
                    : ""
                }
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.08);">
                <p style="margin:0;font-size:12px;line-height:1.5;color:#64748B;">
                  Se você não solicitou este acesso, ignore esta mensagem. Nenhuma senha foi enviada por e-mail.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: ACCOUNT_INVITE_EMAIL_SUBJECT, html, text };
}

// ---------------------------------------------------------------------------
// Password policy — single source of truth shared by the activation form and
// its server-side validation, so the two can never disagree.
// ---------------------------------------------------------------------------

export const ACCOUNT_PASSWORD_MIN_LENGTH = 8;
export const ACCOUNT_PASSWORD_MAX_LENGTH = 72; // bcrypt/SHA-256 input limit

export type PasswordRequirement = {
  id: string;
  label: string;
  test: (value: string) => boolean;
};

/**
 * Mirrors the Supabase default project policy. Deliberately modest: length plus
 * character classes, without composition rules that push users toward
 * predictable substitutions.
 */
export const ACCOUNT_PASSWORD_REQUIREMENTS: readonly PasswordRequirement[] = [
  { id: "length", label: "Pelo menos 8 caracteres", test: (v) => v.length >= ACCOUNT_PASSWORD_MIN_LENGTH },
  { id: "upper", label: "Uma letra maiúscula", test: (v) => /[A-Z]/.test(v) },
  { id: "lower", label: "Uma letra minúscula", test: (v) => /[a-z]/.test(v) },
  { id: "digit", label: "Um número", test: (v) => /[0-9]/.test(v) },
];

export function describePasswordProblems(value: string): string[] {
  return ACCOUNT_PASSWORD_REQUIREMENTS.filter((requirement) => !requirement.test(value)).map(
    (requirement) => requirement.label
  );
}

export function isPasswordAcceptable(value: string): boolean {
  return (
    value.length >= ACCOUNT_PASSWORD_MIN_LENGTH &&
    value.length <= ACCOUNT_PASSWORD_MAX_LENGTH &&
    describePasswordProblems(value).length === 0
  );
}

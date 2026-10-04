/**
 * Pure domain helpers for the public visitor onboarding flow (SaaS subscriptions).
 * No I/O, no env access — deterministic and unit-testable in isolation.
 */

/** Alphabet without visually ambiguous characters (no 0/O/1/l/I). */
const PASSWORD_ALPHABET = {
  lower: "abcdefghijkmnopqrstuvwxyz",
  upper: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  digits: "23456789",
  symbols: "!@#$%&*?-+=",
} as const;

export const GENERATED_PASSWORD_MIN_LENGTH = 16;

function pickRandomChar(alphabet: string): string {
  const index = Math.floor(Math.random() * alphabet.length);
  return alphabet.charAt(index);
}

function shuffleString(value: string): string {
  const chars = value.split("");
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/**
 * Generates a random temporary password: at least one lowercase, one uppercase,
 * one digit and one symbol, remainder filled from the merged alphabet.
 * Caller stores it ONLY hashed (Supabase auth handles hashing server-side);
 * the plaintext exists solely to be embedded in the single access email.
 */
export function generateTemporaryPassword(
  length: number = GENERATED_PASSWORD_MIN_LENGTH
): string {
  const effectiveLength = Math.max(length, GENERATED_PASSWORD_MIN_LENGTH);
  const required = [
    pickRandomChar(PASSWORD_ALPHABET.lower),
    pickRandomChar(PASSWORD_ALPHABET.upper),
    pickRandomChar(PASSWORD_ALPHABET.digits),
    pickRandomChar(PASSWORD_ALPHABET.symbols),
  ];
  const merged = Object.values(PASSWORD_ALPHABET).join("");
  const filler = Array.from(
    { length: effectiveLength - required.length },
    () => pickRandomChar(merged)
  );
  return shuffleString([...required, ...filler].join(""));
}

/** Stable organization slug derived from the payer email local part. */
export function buildOrganizationSlug(email: string): string {
  const localPart = email.split("@")[0] ?? "";
  const base =
    localPart
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "org";
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

/** Default organization display name shown in the PDV header. */
export function buildOrganizationDisplayName(email: string): string {
  const localPart = email.split("@")[0] ?? "";
  const cleaned = localPart.replace(/[._-]+/g, " ").trim();
  if (!cleaned) return "Minha Loja";
  return cleaned
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export const SUBSCRIPTION_CHECKOUT_SESSION_PREFIX = "nex:checkout:session:";

/** External reference for hosted subscription checkout bound to a public session. */
export function buildCheckoutSessionExternalReference(
  clientMutationId: string
): string {
  return `${SUBSCRIPTION_CHECKOUT_SESSION_PREFIX}${clientMutationId}`;
}

/**
 * Parses the external_reference of a hosted preapproval created from a public
 * session. Returns null for references of the legacy authenticated flow
 * (`nex:org:<uuid>:mut:<uuid>`), which the webhook must keep routing as before.
 */
export function parseCheckoutSessionExternalReference(
  externalReference: string | null | undefined
): { clientMutationId: string } | null {
  if (!externalReference) return null;
  const match = new RegExp(
    `^${SUBSCRIPTION_CHECKOUT_SESSION_PREFIX}([0-9a-f-]{36})$`,
    "i"
  ).exec(externalReference.trim());
  if (!match) return null;
  return { clientMutationId: match[1] };
}

// ---------------------------------------------------------------------------
// Post-purchase access email (pt-BR). Uses a secure activation link only —
// never embeds passwords or tokens in the message body.
// ---------------------------------------------------------------------------

export type AccessEmailContent = {
  subject: string;
  text: string;
  html: string;
};

export const POST_PURCHASE_ACCESS_EMAIL_SUBJECT =
  "Seu acesso ao NEXGESTAOVENDAS está pronto";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildTransactionalAccessEmailContent(input: {
  email: string;
  fullName: string;
  planName: string;
  activationUrl: string;
  loginUrl: string;
  expiresAt: string | null;
  supportEmail?: string | null;
}): AccessEmailContent {
  const url = new URL(input.activationUrl);
  if (url.protocol !== "https:") throw new Error("activation_url_must_be_https");

  const firstName =
    input.fullName.trim().split(/\s+/)[0] ?? input.email.split("@")[0] ?? "Cliente";
  const safeFirstName = escapeHtml(firstName);
  const safePlan = escapeHtml(input.planName.trim());
  const safeLink = escapeHtml(url.toString());
  const safeLoginUrl = escapeHtml(input.loginUrl.replace(/\/+$/, ""));
  const safeSupport = escapeHtml((input.supportEmail ?? "").trim());

  const validity =
    input.expiresAt
      ? `Este link é válido até ${new Intl.DateTimeFormat("pt-BR", {
          dateStyle: "long",
          timeStyle: "short",
          timeZone: "America/Sao_Paulo",
        }).format(new Date(input.expiresAt))}.`
      : "Este link tem prazo de validade. Se expirar, solicite um novo envio ao suporte.";

  const text = [
    `Olá, ${firstName}!`,
    "",
    "Sua compra foi confirmada e seu acesso ao NEXGESTAOVENDAS está pronto.",
    `Plano contratado: ${input.planName}`,
    `E-mail de login: ${input.email}`,
    "",
    "Para definir sua senha e entrar no sistema, acesse:",
    url.toString(),
    "",
    validity,
    "",
    `Após definir sua senha, entre em ${input.loginUrl.replace(/\/+$/, "")} com este e-mail.`,
    "",
    "Se o link expirar, solicite um novo envio ao suporte ou use a recuperação de senha em /login.",
    "",
    "Segurança: não compartilhe este link. Ele é pessoal e permite definir sua senha.",
    safeSupport ? `Dúvidas? Fale com o suporte: ${input.supportEmail}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#0B0F19;font-family:Inter,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0F19;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111827;border:1px solid rgba(255,255,255,0.08);border-radius:16px;">
          <tr><td style="padding:28px 32px 8px;">
            <p style="margin:0;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#2563EB;font-weight:700;">NEXGESTAOVENDAS</p>
            <h1 style="margin:10px 0 0;font-size:22px;color:#F1F5F9;">Pagamento confirmado — defina sua senha</h1>
          </td></tr>
          <tr><td style="padding:20px 32px 32px;">
            <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#E2E8F0;">Olá, ${safeFirstName}!</p>
            <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#E2E8F0;">Sua compra foi confirmada. Use o botão abaixo para definir sua senha e acessar o sistema.</p>
            <p style="margin:0 0 8px;font-size:14px;color:#94A3B8;">Plano: <strong style="color:#F1F5F9;">${safePlan}</strong></p>
            <p style="margin:0 0 24px;font-size:14px;color:#94A3B8;">Login: <strong style="color:#F1F5F9;">${escapeHtml(input.email)}</strong></p>
            <a href="${safeLink}" style="display:inline-block;background:#2563EB;color:#FFF;text-decoration:none;font-size:15px;font-weight:600;padding:13px 24px;border-radius:12px;">Definir senha e entrar</a>
            <p style="margin:20px 0 0;font-size:13px;color:#94A3B8;">Link alternativo:<br /><a href="${safeLink}" style="color:#2563EB;word-break:break-all;">${safeLink}</a></p>
            <p style="margin:20px 0 0;font-size:13px;color:#A7F3D0;">${escapeHtml(validity)}</p>
            <p style="margin:20px 0 0;font-size:13px;color:#94A3B8;">Depois de definir sua senha, acesse <a href="${safeLoginUrl}" style="color:#2563EB;">${safeLoginUrl}</a> para entrar.</p>
            <p style="margin:12px 0 0;font-size:13px;color:#94A3B8;">Se o link expirar, solicite um novo envio ao suporte ou use a recuperação de senha na página de login.</p>
            <p style="margin:16px 0 0;font-size:13px;color:#FCA5A5;"><strong>Segurança:</strong> não compartilhe este link.</p>
            ${safeSupport ? `<p style="margin:12px 0 0;font-size:13px;color:#94A3B8;">Suporte: <a href="mailto:${safeSupport}" style="color:#2563EB;">${safeSupport}</a></p>` : ""}
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject: POST_PURCHASE_ACCESS_EMAIL_SUBJECT, html, text };
}

/** @deprecated Use buildTransactionalAccessEmailContent — passwords are never emailed. */
export function buildAccessEmailContent(input: {
  appOrigin: string;
  email: string;
  temporaryPassword: string;
  planName: string;
}): AccessEmailContent {
  const origin = input.appOrigin.replace(/\/$/, "");
  return buildTransactionalAccessEmailContent({
    email: input.email,
    fullName: input.email.split("@")[0] ?? "Cliente",
    planName: input.planName,
    activationUrl: `${origin}/ativar-conta`,
    loginUrl: `${origin}/login`,
    expiresAt: null,
  });
}

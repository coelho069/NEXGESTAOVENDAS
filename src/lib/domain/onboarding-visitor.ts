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
// Access email content (pt-BR) — rendered by the sender; no secrets besides the
// temporary password, never logged, never persisted as plaintext.
// ---------------------------------------------------------------------------

export type AccessEmailContent = {
  subject: string;
  text: string;
  html: string;
};

export function buildAccessEmailContent(input: {
  appOrigin: string;
  email: string;
  temporaryPassword: string;
  planName: string;
}): AccessEmailContent {
  const loginUrl = `${input.appOrigin.replace(/\/$/, "")}/login`;
  const subject = "Seu acesso ao Nex Gestão Vendas está pronto";
  const text = [
    "Bem-vindo ao Nex Gestão Vendas!",
    "",
    `Plano contratado: ${input.planName}`,
    "",
    "Acesse a plataforma:",
    loginUrl,
    "",
    `E-mail (login): ${input.email}`,
    `Senha inicial temporária: ${input.temporaryPassword}`,
    "",
    "IMPORTANTE: por segurança, troque esta senha no primeiro acesso.",
    "Nunca compartilhe estes dados.",
  ].join("\n");
  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;">',
    '  <h2 style="color:#059669;">Bem-vindo ao Nex Gestão Vendas!</h2>',
    `  <p>Plano contratado: <strong>${input.planName}</strong></p>`,
    '  <p>Acesse a plataforma:</p>',
    `  <p><a href="${loginUrl}">${loginUrl}</a></p>`,
    '  <div style="border:1px solid #e2e8f0;border-radius:8px;padding:16px;background:#f8fafc;">',
    `    <p>E-mail (login): <strong>${input.email}</strong></p>`,
    `    <p>Senha inicial temporária: <strong>${input.temporaryPassword}</strong></p>`,
    "  </div>",
    '  <p style="color:#b91c1c;"><strong>IMPORTANTE:</strong> por segurança, troque esta senha no primeiro acesso.</p>',
    "  <p style=\"color:#64748b;font-size:12px;\">Nunca compartilhe estes dados. Se você não solicitou este acesso, ignore este e-mail.</p>",
    "</div>",
  ].join("");
  return { subject, text, html };
}

export type RefundGmailAccess = "allowed" | "unauthenticated" | "gmail_required";

export const REFUND_GMAIL_REQUIRED_MESSAGE =
  "O acesso ao reembolso exige uma conta Gmail verificada.";

/** Trimmed, lowercase address with a single @ and domain gmail.com. Spaces never pass. */
export function normalizedVerifiedGmail(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || /\s/u.test(trimmed)) return null;
  const at = trimmed.indexOf("@");
  if (at <= 0 || at !== trimmed.lastIndexOf("@")) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!local || domain !== "gmail.com") return null;
  return trimmed;
}

export function refundGmailAccess(input: {
  email?: string | null;
  emailConfirmedAt?: string | null;
} | null): RefundGmailAccess {
  if (!input) return "unauthenticated";
  const email = normalizedVerifiedGmail(input.email);
  const confirmed = typeof input.emailConfirmedAt === "string" && input.emailConfirmedAt.trim().length > 0;
  if (!email || !confirmed) return "gmail_required";
  return "allowed";
}

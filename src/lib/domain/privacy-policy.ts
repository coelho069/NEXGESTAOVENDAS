/**
 * Public privacy notice identifiers for the Nex Gestão Vendas SaaS.
 * This is an operational transparency notice, not a claim of full LGPD certification.
 * Legal identity placeholders follow the same rules as refund-policy.ts.
 */

import {
  COMPANY_TRADE_NAME,
  PUBLIC_SITE_ORIGIN,
  REFUND_POLICY_PATH,
  getPublicCompanyProfile,
  type PublicCompanyProfile,
} from "@/lib/domain/refund-policy";

export const PRIVACY_POLICY_PATH = "/politica-de-privacidade";

export const PRIVACY_POLICY_CANONICAL_URL = `${PUBLIC_SITE_ORIGIN}${PRIVACY_POLICY_PATH}`;

/** Alias paths that must 301 to {@link PRIVACY_POLICY_PATH}. */
export const PRIVACY_POLICY_REDIRECT_SOURCES = [
  "/privacidade",
  "/lgpd",
  "/privacy",
] as const;

/** Vigência desta versão (ISO YYYY-MM-DD). */
export const PRIVACY_POLICY_EFFECTIVE_DATE_ISO = "2026-10-15";

export { COMPANY_TRADE_NAME, REFUND_POLICY_PATH, getPublicCompanyProfile };
export type { PublicCompanyProfile };

export function privacyPolicyCheckoutNotice(): string {
  return `Ao usar o Nex Gestão Vendas, você declara ter lido o Aviso de Privacidade (${PRIVACY_POLICY_CANONICAL_URL}).`;
}

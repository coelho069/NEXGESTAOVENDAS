/**
 * Public refund/return policy identifiers for the SaaS subscription.
 * Legal identity (CNPJ / razão social) is never invented: missing values stay
 * as explicit placeholders until set via public env.
 */

export const PUBLIC_SITE_ORIGIN = "https://nexgestaovendas.com.br";

export const REFUND_POLICY_PATH = "/politica-de-reembolso";

export const REFUND_POLICY_CANONICAL_URL = `${PUBLIC_SITE_ORIGIN}${REFUND_POLICY_PATH}`;

/** Alias paths that must 301 to {@link REFUND_POLICY_PATH}. */
export const REFUND_POLICY_REDIRECT_SOURCES = [
  "/politica-de-reembolsos",
  "/reembolso",
] as const;

export const COMPANY_TRADE_NAME = "Nex Gestão Vendas";

export const PLACEHOLDER_LEGAL_NAME = "[Razão social a informar]";
export const PLACEHOLDER_CNPJ = "[CNPJ a informar]";
export const PLACEHOLDER_SUPPORT_EMAIL = "[e-mail de suporte a informar]";

/** Dias corridos após a cobrança paga para pedir reembolso. */
export const REFUND_WINDOW_DAYS = 7;

/** Dias corridos após a cobrança paga de um plano anual. Sem rateio depois disso. */
export const YEARLY_PLAN_REFUND_WINDOW_DAYS = 7;

/** Prazo máximo de análise do pedido, em dias úteis. */
export const REFUND_REVIEW_BUSINESS_DAYS = 5;

/** Vigência desta versão (ISO YYYY-MM-DD). A contratação pública é Mercado Pago Checkout Pro. */
export const POLICY_EFFECTIVE_DATE_ISO = "2026-10-06";

export const REFUND_POLICY_PROCESSOR = "Mercado Pago";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type PublicCompanyProfile = {
  tradeName: string;
  legalName: string;
  cnpj: string;
  jurisdiction: string;
  supportEmail: string;
  hasRegisteredLegalName: boolean;
  hasRegisteredCnpj: boolean;
  hasRegisteredSupportEmail: boolean;
};

function readPublicEnv(
  envSource: Record<string, string | undefined>,
  key: string
): string {
  return envSource[key]?.trim() ?? "";
}

export function isUsablePublicEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

export function getPublicCompanyProfile(
  envSource: Record<string, string | undefined> = process.env
): PublicCompanyProfile {
  const legalName = readPublicEnv(envSource, "NEXT_PUBLIC_COMPANY_LEGAL_NAME") || PLACEHOLDER_LEGAL_NAME;
  const cnpj = readPublicEnv(envSource, "NEXT_PUBLIC_COMPANY_CNPJ") || PLACEHOLDER_CNPJ;
  const uf = readPublicEnv(envSource, "NEXT_PUBLIC_COMPANY_UF");
  const supportEmail =
    readPublicEnv(envSource, "NEXT_PUBLIC_SUPPORT_EMAIL") || PLACEHOLDER_SUPPORT_EMAIL;

  return {
    tradeName: COMPANY_TRADE_NAME,
    legalName,
    cnpj,
    jurisdiction: uf || "Brasil",
    supportEmail,
    hasRegisteredLegalName: legalName !== PLACEHOLDER_LEGAL_NAME,
    hasRegisteredCnpj: cnpj !== PLACEHOLDER_CNPJ,
    hasRegisteredSupportEmail: isUsablePublicEmail(supportEmail),
  };
}

/** Checkout notice. The name predates the Mercado Pago public rail; the text is processor-neutral. */
export function stripeCheckoutRefundPolicyNotice(): string {
  return refundPolicyCheckoutNotice();
}

export function refundPolicyCheckoutNotice(): string {
  return `Ao confirmar o pagamento, você concorda com a Política de Reembolsos e Devoluções (${REFUND_POLICY_CANONICAL_URL}).`;
}

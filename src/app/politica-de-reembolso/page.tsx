import type { Metadata } from "next";
import { RefundPolicyPage } from "@/components/marketing/refund-policy-page";
import {
  REFUND_POLICY_CANONICAL_URL,
  getPublicCompanyProfile,
} from "@/lib/domain/refund-policy";

/** Dias corridos após a primeira cobrança paga para pedir reembolso. Edite aqui. */
const REFUND_WINDOW_DAYS = 7;

/**
 * Dias corridos após a primeira cobrança paga de um plano anual.
 * Depois deste prazo o ciclo anual restante não é estornado. Edite aqui.
 */
const YEARLY_PLAN_REFUND_WINDOW_DAYS = 7;

/** Prazo máximo de análise do pedido, em dias úteis. Edite aqui. */
const REFUND_REVIEW_BUSINESS_DAYS = 5;

/** Data de vigência desta versão (ISO YYYY-MM-DD). Edite aqui. */
const POLICY_EFFECTIVE_DATE_ISO = "2026-09-27";

export const metadata: Metadata = {
  title: "Política de Reembolsos e Devoluções — Nex Gestão Vendas",
  description: `Regras de reembolso e devolução da assinatura Nex Gestão Vendas: prazo de ${REFUND_WINDOW_DAYS} dias na primeira cobrança, como solicitar, PIX, cancelamento e quando não há estorno.`,
  alternates: {
    canonical: REFUND_POLICY_CANONICAL_URL,
  },
};

export default function PoliticaDeReembolsoRoute() {
  return (
    <RefundPolicyPage
      company={getPublicCompanyProfile()}
      refundWindowDays={REFUND_WINDOW_DAYS}
      yearlyPlanRefundWindowDays={YEARLY_PLAN_REFUND_WINDOW_DAYS}
      reviewBusinessDays={REFUND_REVIEW_BUSINESS_DAYS}
      effectiveDateIso={POLICY_EFFECTIVE_DATE_ISO}
    />
  );
}

import type { Metadata } from "next";
import { RefundPolicyPage } from "@/components/marketing/refund-policy-page";
import {
  POLICY_EFFECTIVE_DATE_ISO,
  REFUND_POLICY_CANONICAL_URL,
  REFUND_REVIEW_BUSINESS_DAYS,
  REFUND_WINDOW_DAYS,
  YEARLY_PLAN_REFUND_WINDOW_DAYS,
  getPublicCompanyProfile,
} from "@/lib/domain/refund-policy";

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

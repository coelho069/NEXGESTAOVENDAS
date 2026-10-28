import type { Metadata } from "next";
import { PrivacyPolicyPage } from "@/components/marketing/privacy-policy-page";
import {
  PRIVACY_POLICY_CANONICAL_URL,
  PRIVACY_POLICY_EFFECTIVE_DATE_ISO,
  getPublicCompanyProfile,
} from "@/lib/domain/privacy-policy";

export const metadata: Metadata = {
  title: "Aviso de Privacidade — Nex Gestão Vendas",
  description:
    "Como o Nex Gestão Vendas trata dados pessoais: conta SaaS, cadastro de clientes no PDV, cookies essenciais, direitos do titular e canais de pedido LGPD.",
  alternates: {
    canonical: PRIVACY_POLICY_CANONICAL_URL,
  },
};

export default function PoliticaDePrivacidadeRoute() {
  return (
    <PrivacyPolicyPage
      company={getPublicCompanyProfile()}
      effectiveDateIso={PRIVACY_POLICY_EFFECTIVE_DATE_ISO}
    />
  );
}

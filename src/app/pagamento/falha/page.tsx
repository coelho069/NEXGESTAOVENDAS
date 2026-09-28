import type { Metadata } from "next";
import { PaymentConfirmationScreen } from "@/components/marketing/payment-confirmation-screen";

export const metadata: Metadata = {
  title: "Pagamento não concluído — Nex Gestão Vendas",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

export default function PagamentoFalhaPage() {
  return <PaymentConfirmationScreen variant="falha" query={{}} loginHref="/login" />;
}

import type { Metadata } from "next";
import { PaymentConfirmationScreen } from "@/components/marketing/payment-confirmation-screen";

export const metadata: Metadata = {
  title: "Pagamento confirmado — Nex Gestão Vendas",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

export default function PagamentoSucessoPage() {
  return <PaymentConfirmationScreen variant="sucesso" query={{}} loginHref="/login" />;
}

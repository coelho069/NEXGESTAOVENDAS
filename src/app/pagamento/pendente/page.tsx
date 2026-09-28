import type { Metadata } from "next";
import { PaymentConfirmationScreen } from "@/components/marketing/payment-confirmation-screen";

export const metadata: Metadata = {
  title: "Pagamento em processamento — Nex Gestão Vendas",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

export default function PagamentoPendentePage() {
  return <PaymentConfirmationScreen variant="pendente" query={{}} loginHref="/login" />;
}

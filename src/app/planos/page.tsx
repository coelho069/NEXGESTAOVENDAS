import type { Metadata } from "next";
import localFont from "next/font/local";
import { PlansSalesPage } from "@/components/marketing/plans-sales-page";
import { getAuthedContext } from "@/lib/auth/session";
import { isMercadoPagoCheckoutEnabled } from "@/lib/server/mercadopago";
import { loadPublicPlans } from "@/lib/server/public-plans-query";

export const dynamic = "force-dynamic";

// Self-hosted variable latin fonts (same files Google serves for these families).
// Weight ranges cover the weights the page used before: Inter 400-700, Jakarta 600-800.
const inter = localFont({
  src: "../fonts/inter-latin-variable.woff2",
  weight: "400 700",
  display: "swap",
  variable: "--font-inter",
});

const jakarta = localFont({
  src: "../fonts/plus-jakarta-sans-latin-variable.woff2",
  weight: "600 800",
  display: "swap",
  variable: "--font-jakarta",
});

export const metadata: Metadata = {
  title: "Nex Gestão Vendas — Planos PDV",
  description:
    "Planos de assinatura do PDV local-first Nex Gestão Vendas para varejo brasileiro.",
};


export default async function PlanosPage() {
  const [auth, plansResult] = await Promise.all([getAuthedContext(), loadPublicPlans()]);

  const pdvHref = auth?.storeId ? `/pdv?store=${encodeURIComponent(auth.storeId)}` : "/pdv";

  return (
    <div className={`${inter.variable} ${jakarta.variable}`}>
      <PlansSalesPage
        plans={plansResult.data ?? []}
        loadError={plansResult.error}
        isAuthenticated={auth !== null}
        checkoutEnabled={isMercadoPagoCheckoutEnabled()}
        pdvHref={pdvHref}
      />
    </div>
  );
}

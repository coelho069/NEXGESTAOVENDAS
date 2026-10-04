import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { PlansSalesPage } from "@/components/marketing/plans-sales-page";
import { getAuthedContext } from "@/lib/auth/session";
import { isMercadoPagoCheckoutEnabled } from "@/lib/server/mercadopago";
import { loadPublicPlans } from "@/lib/server/public-plans-query";

export const dynamic = "force-dynamic";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-inter",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
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

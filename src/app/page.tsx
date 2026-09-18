import { PlansSalesPage } from "@/components/marketing/plans-sales-page";
import { getAuthedContext } from "@/lib/auth/session";
import { isStripeSubscriptionCheckoutEnabled } from "@/lib/domain/onboarding-stripe";
import { loadPublicPlans } from "@/lib/server/public-plans-query";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [auth, plansResult] = await Promise.all([getAuthedContext(), loadPublicPlans()]);

  const pdvHref = auth?.storeId ? `/pdv?store=${encodeURIComponent(auth.storeId)}` : "/pdv";

  return (
    <PlansSalesPage
      plans={plansResult.data ?? []}
      loadError={plansResult.error}
      isAuthenticated={auth !== null}
      checkoutEnabled={isStripeSubscriptionCheckoutEnabled()}
      pdvHref={pdvHref}
    />
  );
}

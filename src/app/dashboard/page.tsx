import { SubscriptionAccessFrame } from "@/components/auth/subscription-access-frame";
import { DashboardScreen } from "@/components/dashboard/dashboard-screen";
import { AppNav } from "@/components/layout/app-nav";
import { getElectronicPaymentAdapterAlerts } from "@/lib/adapters/payment";
import { getPlatformAdminAccess } from "@/lib/auth/admin";
import { getAuthedContext } from "@/lib/auth/session";
import { loadDashboard } from "@/lib/server/dashboard-query";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ store?: string; from?: string; to?: string; cursor?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const [auth, platformAdmin] = await Promise.all([
    getAuthedContext(resolvedSearchParams?.store),
    getPlatformAdminAccess(),
  ]);
  const initial = await loadDashboard({
    storeId: resolvedSearchParams?.store,
    from: resolvedSearchParams?.from,
    to: resolvedSearchParams?.to,
    cursorSku: resolvedSearchParams?.cursor,
  });

  return (
    <main>
      <SubscriptionAccessFrame orgId={auth?.orgId ?? null} role={initial.role} skip={!auth}>
        <div className="border-b border-slate-200 bg-white px-4 py-3">
          <AppNav
            role={initial.role}
            storeId={initial.storeId}
            isPlatformAdmin={platformAdmin !== null}
          />
        </div>
        <DashboardScreen
          storeId={initial.storeId}
          initial={initial}
          paymentAlerts={getElectronicPaymentAdapterAlerts()}
        />
      </SubscriptionAccessFrame>
    </main>
  );
}

import { DashboardScreen } from "@/components/dashboard/dashboard-screen";
import { AppNav } from "@/components/layout/app-nav";
import { loadDashboard } from "@/lib/server/dashboard-query";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ store?: string; from?: string; to?: string; cursor?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const initial = await loadDashboard({
    storeId: resolvedSearchParams?.store,
    from: resolvedSearchParams?.from,
    to: resolvedSearchParams?.to,
    cursorSku: resolvedSearchParams?.cursor,
  });

  return (
    <main>
      <div className="border-b border-slate-200 bg-white px-4 py-3">
        <AppNav role={initial.role} storeId={initial.storeId} />
      </div>
      <DashboardScreen storeId={initial.storeId} initial={initial} />
    </main>
  );
}

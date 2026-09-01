import { DashboardScreen } from "@/components/dashboard/dashboard-screen";
import { AppNav } from "@/components/layout/app-nav";
import { loadDashboard } from "@/lib/server/dashboard-query";

export const dynamic = "force-dynamic";

const DEFAULT_STORE = "22222222-2222-4222-8222-222222222201";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: { store?: string; from?: string; to?: string; cursor?: string };
}) {
  const storeId = searchParams?.store || DEFAULT_STORE;
  const initial = await loadDashboard({
    storeId,
    from: searchParams?.from,
    to: searchParams?.to,
    cursorSku: searchParams?.cursor,
  });

  return (
    <main>
      <div className="border-b border-slate-200 bg-white px-4 py-3">
        <AppNav role={initial.role} />
      </div>
      <DashboardScreen storeId={storeId} initial={initial} />
    </main>
  );
}

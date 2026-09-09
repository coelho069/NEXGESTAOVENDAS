import { SubscriptionAccessFrame } from "@/components/auth/subscription-access-frame";
import { InventoryScreen } from "@/components/inventory/inventory-screen";
import { AppNav } from "@/components/layout/app-nav";
import { getAuthedContext } from "@/lib/auth/session";
import { loadInventory } from "@/lib/server/inventory-query";

export const dynamic = "force-dynamic";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams?: Promise<{ store?: string; cursor?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const auth = await getAuthedContext(resolvedSearchParams?.store);
  const initial = await loadInventory({
    storeId: resolvedSearchParams?.store,
    cursorSku: resolvedSearchParams?.cursor,
  });

  return (
    <main>
      <SubscriptionAccessFrame orgId={auth?.orgId ?? null} role={initial.role} skip={!auth}>
        <div className="border-b border-slate-200 bg-white px-4 py-3">
          <AppNav role={initial.role} storeId={initial.storeId} />
        </div>
        <InventoryScreen storeId={initial.storeId} initial={initial} />
      </SubscriptionAccessFrame>
    </main>
  );
}

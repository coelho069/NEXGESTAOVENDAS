import { SubscriptionAccessFrame } from "@/components/auth/subscription-access-frame";
import { InventoryScreen } from "@/components/inventory/inventory-screen";
import { AppNav } from "@/components/layout/app-nav";
import { getPlatformAdminAccess } from "@/lib/auth/admin";
import { getAuthedContext } from "@/lib/auth/session";
import { loadInventory } from "@/lib/server/inventory-query";

export const dynamic = "force-dynamic";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams?: Promise<{ store?: string; cursor?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const [auth, platformAdmin] = await Promise.all([
    getAuthedContext(resolvedSearchParams?.store),
    getPlatformAdminAccess(),
  ]);
  const initial = await loadInventory({
    storeId: resolvedSearchParams?.store,
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
        <InventoryScreen storeId={initial.storeId} initial={initial} />
      </SubscriptionAccessFrame>
    </main>
  );
}

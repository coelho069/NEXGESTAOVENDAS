import { InventoryScreen } from "@/components/inventory/inventory-screen";
import { AppNav } from "@/components/layout/app-nav";
import { loadInventory } from "@/lib/server/inventory-query";

export const dynamic = "force-dynamic";

const DEFAULT_STORE = "22222222-2222-4222-8222-222222222201";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams?: { store?: string; cursor?: string };
}) {
  const storeId = searchParams?.store || DEFAULT_STORE;
  const initial = await loadInventory({ storeId, cursorSku: searchParams?.cursor });

  return (
    <main>
      <div className="border-b border-slate-200 bg-white px-4 py-3">
        <AppNav role={initial.role} />
      </div>
      <InventoryScreen storeId={storeId} initial={initial} />
    </main>
  );
}

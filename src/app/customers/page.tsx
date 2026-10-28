import { AppNav } from "@/components/layout/app-nav";
import { CustomersScreen } from "@/components/customers/customers-screen";
import { loadCustomers } from "@/lib/server/customers-query";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams?: Promise<{ store?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const initial = await loadCustomers({ storeId: resolvedSearchParams?.store });

  return (
    <main>
      <div className="border-b border-slate-200 bg-white px-4 py-3">
        <AppNav role={initial.role} storeId={initial.storeId} />
      </div>
      <CustomersScreen
        storeId={initial.storeId}
        canEdit={initial.canEdit}
        initialRows={initial.rows}
      />
    </main>
  );
}

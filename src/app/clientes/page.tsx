import { SubscriptionAccessFrame } from "@/components/auth/subscription-access-frame";
import { CustomersScreen } from "@/components/customers/customers-screen";
import { AppNav } from "@/components/layout/app-nav";
import { getAuthedContext } from "@/lib/auth/session";
import { pdvFixturesEnabled } from "@/lib/pdv/fixtures";
import type { MemberRole } from "@/lib/domain/rbac";

export const dynamic = "force-dynamic";

function fixtureRoleFromSearch(role: string | undefined): MemberRole {
  if (role === "manager" || role === "admin" || role === "cashier") return role;
  return "cashier";
}

export default async function ClientesPage({
  searchParams,
}: {
  searchParams?: Promise<{ store?: string; role?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const auth = await getAuthedContext(resolvedSearchParams?.store);
  const fixtureMode = !auth && pdvFixturesEnabled();
  const role = auth?.role ?? (fixtureMode ? fixtureRoleFromSearch(resolvedSearchParams?.role) : null);
  const storeId = auth?.storeId ?? resolvedSearchParams?.store ?? null;

  return (
    <main>
      <SubscriptionAccessFrame orgId={auth?.orgId ?? null} role={role} skip={fixtureMode || !auth}>
        <div className="border-b border-slate-200 bg-white px-4 py-3">
          <AppNav role={role} storeId={storeId} />
        </div>
        <CustomersScreen />
      </SubscriptionAccessFrame>
    </main>
  );
}

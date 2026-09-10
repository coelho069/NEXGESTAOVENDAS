import { AdminDashboardScreen } from "@/components/admin/admin-dashboard-screen";
import { loadCurrentAdminSubscriptions } from "@/lib/server/admin-subscriptions-query";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const result = await loadCurrentAdminSubscriptions();

  return <AdminDashboardScreen data={result.data} error={result.error} />;
}

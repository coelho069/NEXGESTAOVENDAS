import { AdminPlansScreen } from "@/components/admin/admin-plans-screen";
import { loadCurrentAdminPlans } from "@/lib/server/admin-subscriptions-query";

export const dynamic = "force-dynamic";

export default async function AdminPlanosPage() {
  const result = await loadCurrentAdminPlans();
  return <AdminPlansScreen data={result.data} error={result.error} />;
}

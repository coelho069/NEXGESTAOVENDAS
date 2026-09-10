import { notFound } from "next/navigation";
import { AdminSubscriptionDetailScreen } from "@/components/admin/admin-subscription-detail";
import { getPlatformAdminAccess } from "@/lib/auth/admin";
import {
  loadAdminPlans,
  loadAdminSubscriptionDetail,
} from "@/lib/server/admin-subscriptions-query";
import { z } from "zod";

const organizationIdSchema = z.string().uuid();

export const dynamic = "force-dynamic";

export default async function AdminAssinaturaDetailPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const parsedId = organizationIdSchema.safeParse(organizationId);
  if (!parsedId.success) notFound();

  const access = await getPlatformAdminAccess();
  if (!access) notFound();

  const [detailResult, plansResult] = await Promise.all([
    loadAdminSubscriptionDetail(access, parsedId.data),
    loadAdminPlans(access),
  ]);

  if (!detailResult.data && !detailResult.error) notFound();

  return (
    <AdminSubscriptionDetailScreen
      data={detailResult.data}
      error={detailResult.error ?? plansResult.error}
      plans={plansResult.data ?? []}
    />
  );
}

import { AdminSubscriptionsScreen } from "@/components/admin/admin-subscriptions-screen";
import { adminSubscriptionListQuerySchema } from "@/lib/validation/schemas";
import { loadCurrentAdminSubscriptions } from "@/lib/server/admin-subscriptions-query";

export const dynamic = "force-dynamic";

type AdminSubscriptionSearchParams = {
  query?: string | string[];
  plan?: string | string[];
  plan_id?: string | string[];
  status?: string | string[];
  expires_from?: string | string[];
  expires_to?: string | string[];
};

function optionalParam(value: string | string[] | undefined): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  const trimmed = candidate?.trim();
  return trimmed ? trimmed : undefined;
}

export default async function AdminSubscriptionsPage({
  searchParams,
}: {
  searchParams?: Promise<AdminSubscriptionSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const parsed = adminSubscriptionListQuerySchema.safeParse({
    query: optionalParam(resolvedSearchParams?.query),
    plan: optionalParam(resolvedSearchParams?.plan),
    plan_id: optionalParam(resolvedSearchParams?.plan_id),
    status: optionalParam(resolvedSearchParams?.status),
    expires_from: optionalParam(resolvedSearchParams?.expires_from),
    expires_to: optionalParam(resolvedSearchParams?.expires_to),
  });
  const filters = parsed.success
    ? {
        query: parsed.data.query,
        plan: parsed.data.plan,
        planId: parsed.data.plan_id,
        status: parsed.data.status,
        expiresFrom: parsed.data.expires_from,
        expiresTo: parsed.data.expires_to,
      }
    : {};
  const result = await loadCurrentAdminSubscriptions(filters);

  return (
    <AdminSubscriptionsScreen
      data={result.data}
      error={result.error ?? (parsed.success ? null : "invalid_filters")}
      filters={filters}
    />
  );
}

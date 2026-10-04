import { AdminClientAccountsScreen } from "@/components/admin/admin-client-accounts-screen";
import { adminClientAccountListQuerySchema } from "@/lib/validation/schemas";
import { loadCurrentAdminClientAccounts } from "@/lib/server/admin-client-accounts-query";

export const dynamic = "force-dynamic";

type SearchParams = {
  query?: string | string[];
  status?: string | string[];
  subscription_status?: string | string[];
};

function optionalParam(value: string | string[] | undefined): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  const trimmed = candidate?.trim();
  return trimmed ? trimmed : undefined;
}

export default async function AdminClientAccountsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  // /admin/layout.tsx already gates the whole tree on platform-admin access.
  const resolved = await searchParams;
  const parsed = adminClientAccountListQuerySchema.safeParse({
    query: optionalParam(resolved?.query),
    status: optionalParam(resolved?.status),
    subscription_status: optionalParam(resolved?.subscription_status),
  });

  const filters = parsed.success
    ? {
        query: parsed.data.query,
        status: parsed.data.status,
        subscriptionStatus: parsed.data.subscription_status,
      }
    : {};

  const result = await loadCurrentAdminClientAccounts(filters);

  return (
    <AdminClientAccountsScreen
      data={result.data}
      error={result.error ?? (parsed.success ? null : "invalid_filters")}
      filters={filters}
    />
  );
}

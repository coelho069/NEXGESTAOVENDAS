import { getPlatformAdminAccess, type PlatformAdminAccess } from "@/lib/auth/admin";
import {
  buildAdminSubscriptionOverview,
  describeSubscriptionAccessForAdmin,
  filterAdminSubscriptionRecords,
  findNextSubscriptionExpirations,
  normalizeAdminSubscriptionStatus,
  pickCurrentSubscription,
  type AdminContactRecord,
  type AdminPlanRecord,
  type AdminSubscriptionDetail,
  type AdminSubscriptionFilters,
  type AdminSubscriptionRecord,
  type AdminSubscriptionsPayload,
  type AdminStoreRecord,
  type SubscriptionBillingInterval,
} from "@/lib/domain/admin-subscriptions";
import type { MemberRole } from "@/lib/domain/rbac";
import type { Tables } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

type OrganizationRow = Pick<
  Tables<"organizations">,
  "id" | "name" | "slug" | "currency" | "timezone" | "updated_at"
>;

type StoreRow = Pick<
  Tables<"stores">,
  "id" | "org_id" | "name" | "code" | "is_active" | "created_at" | "updated_at"
>;

type ProfileRow = Pick<Tables<"profiles">, "id" | "org_id" | "full_name" | "email">;
type MembershipRow = Pick<Tables<"store_members">, "user_id" | "store_id" | "org_id" | "role">;
type PlanRow = Pick<
  Tables<"plans">,
  | "id"
  | "name"
  | "description"
  | "amount"
  | "currency"
  | "billing_interval"
  | "is_active"
  | "created_at"
  | "updated_at"
>;
type SubscriptionRow = Pick<
  Tables<"subscriptions">,
  | "id"
  | "org_id"
  | "plan_id"
  | "status"
  | "contracted_amount"
  | "currency"
  | "period_start"
  | "period_end"
  | "cancelled_at"
  | "created_at"
  | "updated_at"
>;

export type AdminSubscriptionQueryResult<T> = {
  data: T | null;
  error: string | null;
};

const DATA_QUERY_ERROR = "admin_subscriptions_unavailable";
const PAGE_SIZE = 1000;

function latestTimestamp(values: readonly string[]): string {
  return values.reduce((latest, value) => (value > latest ? value : latest), values[0] ?? "");
}

function rolePriority(role: MemberRole): number {
  if (role === "admin") return 3;
  if (role === "manager") return 2;
  return 1;
}

function asAmount(value: number | string): string {
  return typeof value === "number" ? value.toFixed(2) : value;
}

function buildContacts(
  profiles: readonly ProfileRow[],
  memberships: readonly MembershipRow[]
): AdminContactRecord[] {
  const rolesByUser = new Map<string, MemberRole>();
  for (const membership of memberships) {
    const currentRole = rolesByUser.get(membership.user_id);
    if (!currentRole || rolePriority(membership.role) > rolePriority(currentRole)) {
      rolesByUser.set(membership.user_id, membership.role);
    }
  }

  return profiles
    .filter((profile) => rolesByUser.has(profile.id))
    .map((profile) => ({
      id: profile.id,
      fullName: profile.full_name,
      email: profile.email,
      role: rolesByUser.get(profile.id) ?? null,
    }))
    .sort((left, right) => left.fullName.localeCompare(right.fullName, "pt-BR"));
}

type PageResponse<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

async function readAllRows<T>(
  loadPage: (from: number, to: number) => Promise<PageResponse<T>>
): Promise<{ data: T[]; error: string | null }> {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await loadPage(from, from + PAGE_SIZE - 1);
    if (page.error) return { data: [], error: page.error.message };

    const batch = page.data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return { data: rows, error: null };
  }
}

function toRecord(input: {
  organization: OrganizationRow;
  subscription: SubscriptionRow | null;
  plan: PlanRow | null;
  stores: readonly StoreRow[];
  memberships: readonly MembershipRow[];
}): AdminSubscriptionRecord {
  const activeStoreCount = input.stores.filter((store) => store.is_active).length;
  const lastUpdated = latestTimestamp(
    [
      input.organization.updated_at,
      ...input.stores.map((store) => store.updated_at),
      input.subscription?.updated_at ?? "",
    ].filter(Boolean)
  );

  if (!input.subscription) {
    const access = describeSubscriptionAccessForAdmin(null);
    return {
      id: input.organization.id,
      subscriptionId: null,
      clientName: input.organization.name,
      clientSlug: input.organization.slug,
      planId: null,
      planName: null,
      status: "none",
      billingInterval: null,
      startedAt: null,
      expiresAt: null,
      amount: null,
      cancelledAt: null,
      subscriptionCreatedAt: null,
      subscriptionUpdatedAt: null,
      pdvStatus: activeStoreCount > 0 ? "active" : "inactive",
      accessAllowed: access.accessAllowed,
      accessReason: access.accessReason,
      accessMessage: access.accessMessage,
      lastUpdated,
      currency: input.organization.currency,
      timezone: input.organization.timezone,
      storeCount: input.stores.length,
      activeStoreCount,
      teamMemberCount: new Set(input.memberships.map((membership) => membership.user_id)).size,
      sourceEntity: "organizations",
    };
  }

  const status = normalizeAdminSubscriptionStatus(input.subscription.status);
  const access = describeSubscriptionAccessForAdmin(input.subscription.status);

  return {
    id: input.organization.id,
    subscriptionId: input.subscription.id,
    clientName: input.organization.name,
    clientSlug: input.organization.slug,
    planId: input.subscription.plan_id,
    planName: input.plan?.name ?? null,
    status,
    billingInterval: (input.plan?.billing_interval as SubscriptionBillingInterval | undefined) ?? null,
    startedAt: input.subscription.period_start,
    expiresAt: input.subscription.period_end,
    amount: asAmount(input.subscription.contracted_amount),
    cancelledAt: input.subscription.cancelled_at,
    subscriptionCreatedAt: input.subscription.created_at,
    subscriptionUpdatedAt: input.subscription.updated_at,
    pdvStatus: activeStoreCount > 0 ? "active" : "inactive",
    accessAllowed: access.accessAllowed,
    accessReason: access.accessReason,
    accessMessage: access.accessMessage,
    lastUpdated,
    currency: input.subscription.currency,
    timezone: input.organization.timezone,
    storeCount: input.stores.length,
    activeStoreCount,
    teamMemberCount: new Set(input.memberships.map((membership) => membership.user_id)).size,
    sourceEntity: "subscriptions",
  };
}

function toPlanRecords(
  plans: readonly PlanRow[],
  subscriptionsByOrg: Map<string, SubscriptionRow[]>
): AdminPlanRecord[] {
  const usage = new Map<string, number>();
  for (const subscriptions of subscriptionsByOrg.values()) {
    for (const subscription of subscriptions) {
      usage.set(subscription.plan_id, (usage.get(subscription.plan_id) ?? 0) + 1);
    }
  }

  return plans
    .map((plan) => ({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      amount: asAmount(plan.amount),
      currency: plan.currency,
      billingInterval: plan.billing_interval as SubscriptionBillingInterval,
      isActive: plan.is_active,
      createdAt: plan.created_at,
      updatedAt: plan.updated_at,
      subscriptionCount: usage.get(plan.id) ?? 0,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
}

async function loadPlatformCatalog(): Promise<
  AdminSubscriptionQueryResult<{
    organizations: OrganizationRow[];
    stores: StoreRow[];
    profiles: ProfileRow[];
    memberships: MembershipRow[];
    plansById: Map<string, PlanRow>;
    subscriptionsByOrg: Map<string, SubscriptionRow[]>;
  }>
> {
  try {
    const supabase = await createClient();
    const [
      organizationsResult,
      storesResult,
      profilesResult,
      membershipsResult,
      plansResult,
      subscriptionsResult,
    ] = await Promise.all([
      readAllRows<OrganizationRow>(async (from, to) =>
        supabase
          .from("organizations")
          .select("id, name, slug, currency, timezone, updated_at")
          .order("id")
          .range(from, to)
      ),
      readAllRows<StoreRow>(async (from, to) =>
        supabase
          .from("stores")
          .select("id, org_id, name, code, is_active, created_at, updated_at")
          .order("id")
          .range(from, to)
      ),
      readAllRows<ProfileRow>(async (from, to) =>
        supabase.from("profiles").select("id, org_id, full_name, email").order("id").range(from, to)
      ),
      readAllRows<MembershipRow>(async (from, to) =>
        supabase
          .from("store_members")
          .select("user_id, store_id, org_id, role")
          .order("id")
          .range(from, to)
      ),
      readAllRows<PlanRow>(async (from, to) =>
        supabase
          .from("plans")
          .select(
            "id, name, description, amount, currency, billing_interval, is_active, created_at, updated_at"
          )
          .order("id")
          .range(from, to)
      ),
      readAllRows<SubscriptionRow>(async (from, to) =>
        supabase
          .from("subscriptions")
          .select(
            "id, org_id, plan_id, status, contracted_amount, currency, period_start, period_end, cancelled_at, created_at, updated_at"
          )
          .order("id")
          .range(from, to)
      ),
    ]);

    if (
      organizationsResult.error ||
      storesResult.error ||
      profilesResult.error ||
      membershipsResult.error ||
      plansResult.error ||
      subscriptionsResult.error
    ) {
      return { data: null, error: DATA_QUERY_ERROR };
    }

    const plansById = new Map(plansResult.data.map((plan) => [plan.id, plan] as const));
    const subscriptionsByOrg = new Map<string, SubscriptionRow[]>();
    for (const subscription of subscriptionsResult.data) {
      const current = subscriptionsByOrg.get(subscription.org_id) ?? [];
      current.push(subscription);
      subscriptionsByOrg.set(subscription.org_id, current);
    }

    return {
      data: {
        organizations: organizationsResult.data,
        stores: storesResult.data,
        profiles: profilesResult.data,
        memberships: membershipsResult.data,
        plansById,
        subscriptionsByOrg,
      },
      error: null,
    };
  } catch {
    return { data: null, error: DATA_QUERY_ERROR };
  }
}

async function isCurrentPlatformAdmin(access: PlatformAdminAccess): Promise<boolean> {
  const currentAccess = await getPlatformAdminAccess();
  return currentAccess?.userId === access.userId;
}

export async function loadAdminSubscriptions(
  _access: PlatformAdminAccess,
  filters: AdminSubscriptionFilters = {}
): Promise<AdminSubscriptionQueryResult<AdminSubscriptionsPayload>> {
  if (!(await isCurrentPlatformAdmin(_access))) {
    return { data: null, error: "forbidden_admin" };
  }

  const catalog = await loadPlatformCatalog();
  if (!catalog.data) return { data: null, error: catalog.error };

  const records = catalog.data.organizations.map((organization) => {
    const orgStores = catalog.data!.stores.filter((store) => store.org_id === organization.id);
    const orgMemberships = catalog.data!.memberships.filter(
      (membership) => membership.org_id === organization.id
    );
    const subscription = pickCurrentSubscription(
      catalog.data!.subscriptionsByOrg.get(organization.id) ?? []
    );
    const plan = subscription ? catalog.data!.plansById.get(subscription.plan_id) ?? null : null;
    return toRecord({
      organization,
      subscription,
      plan,
      stores: orgStores,
      memberships: orgMemberships,
    });
  });

  const filtered = filterAdminSubscriptionRecords(records, filters);
  return {
    data: {
      records: filtered,
      overview: buildAdminSubscriptionOverview(filtered),
      nextExpirations: findNextSubscriptionExpirations(filtered),
      plans: toPlanRecords(Array.from(catalog.data.plansById.values()), catalog.data.subscriptionsByOrg),
      subscriptionDataAvailable: true,
      dataAvailabilityMessage: null,
    },
    error: null,
  };
}

export async function loadAdminSubscriptionDetail(
  _access: PlatformAdminAccess,
  organizationId: string
): Promise<AdminSubscriptionQueryResult<AdminSubscriptionDetail>> {
  if (!(await isCurrentPlatformAdmin(_access))) {
    return { data: null, error: "forbidden_admin" };
  }

  const catalog = await loadPlatformCatalog();
  if (!catalog.data) return { data: null, error: catalog.error };

  const organization = catalog.data.organizations.find((row) => row.id === organizationId);
  if (!organization) return { data: null, error: null };

  const orgStores = catalog.data.stores.filter((store) => store.org_id === organization.id);
  const orgMemberships = catalog.data.memberships.filter(
    (membership) => membership.org_id === organization.id
  );
  const orgProfiles = catalog.data.profiles.filter((profile) => profile.org_id === organization.id);
  const subscription = pickCurrentSubscription(
    catalog.data.subscriptionsByOrg.get(organization.id) ?? []
  );
  const plan = subscription ? catalog.data.plansById.get(subscription.plan_id) ?? null : null;
  const record = toRecord({
    organization,
    subscription,
    plan,
    stores: orgStores,
    memberships: orgMemberships,
  });

  const storeRecords: AdminStoreRecord[] = orgStores
    .map((store) => ({
      id: store.id,
      name: store.name,
      code: store.code,
      isActive: store.is_active,
      lastUpdated: latestTimestamp([store.created_at, store.updated_at]),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));

  return {
    data: {
      ...record,
      stores: storeRecords,
      contacts: buildContacts(orgProfiles, orgMemberships),
    },
    error: null,
  };
}

export async function loadCurrentAdminSubscriptions(
  filters: AdminSubscriptionFilters = {}
): Promise<AdminSubscriptionQueryResult<AdminSubscriptionsPayload>> {
  const access = await getPlatformAdminAccess();
  if (!access) return { data: null, error: "forbidden_admin" };
  return loadAdminSubscriptions(access, filters);
}

export async function loadAdminPlans(
  _access: PlatformAdminAccess
): Promise<AdminSubscriptionQueryResult<AdminPlanRecord[]>> {
  if (!(await isCurrentPlatformAdmin(_access))) {
    return { data: null, error: "forbidden_admin" };
  }

  const catalog = await loadPlatformCatalog();
  if (!catalog.data) return { data: null, error: catalog.error };

  return {
    data: toPlanRecords(Array.from(catalog.data.plansById.values()), catalog.data.subscriptionsByOrg),
    error: null,
  };
}

export async function loadCurrentAdminPlans(): Promise<
  AdminSubscriptionQueryResult<AdminPlanRecord[]>
> {
  const access = await getPlatformAdminAccess();
  if (!access) return { data: null, error: "forbidden_admin" };
  return loadAdminPlans(access);
}

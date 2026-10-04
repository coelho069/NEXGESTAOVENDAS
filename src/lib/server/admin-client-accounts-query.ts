/**
 * Read model for the administrative client-accounts screen.
 *
 * Mirrors src/lib/server/admin-subscriptions-query.ts: it uses the
 * request-scoped (anon-key) client so RLS and the platform-admin policy remain
 * the enforcement boundary, and it re-verifies admin access on every call.
 */
import { getPlatformAdminAccess, type PlatformAdminAccess } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";
import {
  buildAdminClientAccountOverview,
  filterAdminClientAccountRecords,
  isClientAccountStatus,
  normalizeAccountEmail,
  type AdminClientAccountFilters,
  type AdminClientAccountOrganizationOption,
  CLIENT_ACCOUNT_EVENT_LABELS,
  type AdminClientAccountEventRecord,
  type AdminClientAccountPayload,
  type AdminClientAccountRecord,
  type ClientAccountStatus,
} from "@/lib/domain/admin-client-accounts";
import {
  normalizeAdminSubscriptionStatus,
  type AdminPlanRecord,
  type AdminSubscriptionStatus,
  type SubscriptionBillingInterval,
} from "@/lib/domain/admin-subscriptions";

type QueryResult<T> = { data: T | null; error: string | null };

type AccountRow = Pick<
  Database["public"]["Tables"]["client_accounts"]["Row"],
  | "id"
  | "user_id"
  | "org_id"
  | "subscription_id"
  | "email"
  | "full_name"
  | "company_name"
  | "status"
  | "last_error"
  | "invite_sent_at"
  | "invite_expires_at"
  | "activated_at"
  | "suspended_at"
  | "created_at"
  | "updated_at"
>;

const DATA_QUERY_ERROR = "client_accounts_unavailable";

type Page<T> = { data: T[] | null; error: { message: string } | null };

async function readAllRows<T>(load: (from: number, to: number) => Promise<Page<T>>) {
  const rows: T[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const page = await load(from, from + pageSize - 1);
    if (page.error) return { data: [] as T[], error: page.error.message };
    const batch = page.data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) return { data: rows, error: null };
  }
}

function toAmount(value: number | string): string {
  return typeof value === "number" ? value.toFixed(2) : value;
}

async function isCurrentPlatformAdmin(access: PlatformAdminAccess): Promise<boolean> {
  const current = await getPlatformAdminAccess();
  return !!current && current.userId === access.userId;
}

export async function loadAdminClientAccounts(
  access: PlatformAdminAccess,
  filters: AdminClientAccountFilters = {}
): Promise<QueryResult<AdminClientAccountPayload>> {
  if (!(await isCurrentPlatformAdmin(access))) {
    return { data: null, error: "forbidden_admin" };
  }

  try {
    const supabase = await createClient();

    const [accountsResult, eventsResult, organizationsResult, subscriptionsResult, plansResult] =
      await Promise.all([
        readAllRows<AccountRow>(async (from, to) =>
          supabase
            .from("client_accounts")
            .select(
              "id, user_id, org_id, subscription_id, email, full_name, company_name, status, last_error, invite_sent_at, invite_expires_at, activated_at, suspended_at, created_at, updated_at"
            )
            .order("id")
            .range(from, to)
        ),
        readAllRows<{
          id: string;
          client_account_id: string;
          event_type: string;
          error_code: string;
          created_at: string;
        }>(async (from, to) =>
          supabase
            .from("client_account_events")
            .select("id, client_account_id, event_type, error_code, created_at")
            .order("created_at", { ascending: false })
            .range(from, to)
        ),
        readAllRows<{ id: string; name: string }>(async (from, to) =>
          supabase.from("organizations").select("id, name").order("id").range(from, to)
        ),
        readAllRows<{ id: string; org_id: string; plan_id: string; status: string }>(
          async (from, to) =>
            supabase
              .from("subscriptions")
              .select("id, org_id, plan_id, status")
              .order("id")
              .range(from, to)
        ),
        readAllRows<{
          id: string;
          name: string;
          description: string;
          amount: number | string;
          currency: string;
          billing_interval: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        }>(async (from, to) =>
          supabase
            .from("plans")
            .select(
              "id, name, description, amount, currency, billing_interval, is_active, created_at, updated_at"
            )
            .order("id")
            .range(from, to)
        ),
      ]);

    if (
      accountsResult.error ||
      eventsResult.error ||
      organizationsResult.error ||
      subscriptionsResult.error ||
      plansResult.error
    ) {
      return { data: null, error: DATA_QUERY_ERROR };
    }

    const eventsByAccountId: Record<string, AdminClientAccountEventRecord[]> = {};
    for (const event of eventsResult.data) {
      const mapped: AdminClientAccountEventRecord = {
        id: event.id,
        clientAccountId: event.client_account_id,
        eventType: event.event_type,
        eventLabel: CLIENT_ACCOUNT_EVENT_LABELS[event.event_type] ?? event.event_type,
        errorCode: event.error_code,
        createdAt: event.created_at,
      };
      const bucket = eventsByAccountId[event.client_account_id] ?? [];
      bucket.push(mapped);
      eventsByAccountId[event.client_account_id] = bucket;
    }

    const orgNames = new Map(organizationsResult.data.map((org) => [org.id, org.name]));
    const plansById = new Map(plansResult.data.map((plan) => [plan.id, plan]));
    const subscriptionById = new Map(subscriptionsResult.data.map((sub) => [sub.id, sub]));

    const records: AdminClientAccountRecord[] = accountsResult.data.map((row) => {
      const subscription = row.subscription_id
        ? subscriptionById.get(row.subscription_id) ?? null
        : null;
      const plan = subscription ? plansById.get(subscription.plan_id) ?? null : null;
      return {
        id: row.id,
        userId: row.user_id,
        email: row.email,
        fullName: row.full_name,
        companyName: row.company_name,
        organizationId: row.org_id,
        organizationName: orgNames.get(row.org_id) ?? "—",
        subscriptionId: row.subscription_id,
        planName: plan?.name ?? null,
        status: (isClientAccountStatus(row.status) ? row.status : "created") as ClientAccountStatus,
        lastError: row.last_error,
        inviteSentAt: row.invite_sent_at,
        inviteExpiresAt: row.invite_expires_at,
        activatedAt: row.activated_at,
        suspendedAt: row.suspended_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        subscriptionStatus: subscription
          ? normalizeAdminSubscriptionStatus(subscription.status)
          : null,
        emailConfirmed: false,
      };
    });

    // Auth state is a separate concern from the invitation state: enrich only
    // the rows that actually have a provisioned login.
    const withAuthState = await enrichEmailConfirmation(supabase, records);

    const organizations: AdminClientAccountOrganizationOption[] = organizationsResult.data
      .map((org) => {
        const subscription =
          subscriptionsResult.data.find((sub) => sub.org_id === org.id) ?? null;
        const plan = subscription ? plansById.get(subscription.plan_id) ?? null : null;
        return {
          id: org.id,
          name: org.name,
          subscriptionId: subscription?.id ?? null,
          planId: subscription?.plan_id ?? null,
          planName: plan?.name ?? null,
          subscriptionStatus: subscription
            ? normalizeAdminSubscriptionStatus(subscription.status)
            : null,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));

    const plans: AdminPlanRecord[] = plansResult.data
      .map((plan) => ({
        id: plan.id,
        name: plan.name,
        description: plan.description,
        amount: toAmount(plan.amount),
        currency: plan.currency,
        billingInterval: plan.billing_interval as SubscriptionBillingInterval,
        isActive: plan.is_active,
        createdAt: plan.created_at,
        updatedAt: plan.updated_at,
        subscriptionCount: subscriptionsResult.data.filter((sub) => sub.plan_id === plan.id)
          .length,
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));

    const filtered = filterAdminClientAccountRecords(withAuthState, filters);
    return {
      data: {
        records: filtered,
        eventsByAccountId,
        overview: buildAdminClientAccountOverview(filtered),
        plans,
        organizations,
        dataAvailable: true,
        dataAvailabilityMessage: null,
      },
      error: null,
    };
  } catch {
    return { data: null, error: DATA_QUERY_ERROR };
  }
}

/**
 * Auth-state projection.
 *
 * Reading `auth.users` requires the service role, which this read path
 * deliberately does not use (it runs on the request-scoped client so RLS is the
 * enforcement boundary). Confirmation is therefore derived from the activation
 * timestamp recorded by the provisioning flow, and stays advisory only — it
 * never changes the invitation state, which is owned by the database column.
 */
function enrichEmailConfirmation(
  _supabase: Awaited<ReturnType<typeof createClient>>,
  records: AdminClientAccountRecord[]
): AdminClientAccountRecord[] {
  return records.map((record) => ({
    ...record,
    emailConfirmed: record.status === "activated" && !!record.activatedAt,
  }));
}

export async function loadCurrentAdminClientAccounts(
  filters: AdminClientAccountFilters = {}
): Promise<QueryResult<AdminClientAccountPayload>> {
  const access = await getPlatformAdminAccess();
  if (!access) return { data: null, error: "forbidden_admin" };
  return loadAdminClientAccounts(access, filters);
}

/** Options for the create form: organizations that still lack a client account. */
export function organizationOptionsWithoutAccount(
  organizations: readonly AdminClientAccountOrganizationOption[],
  records: readonly AdminClientAccountRecord[]
): AdminClientAccountOrganizationOption[] {
  const taken = new Set(records.map((record) => record.organizationId));
  return organizations.filter((organization) => !taken.has(organization.id));
}

export function findExistingAccountEmail(
  records: readonly AdminClientAccountRecord[],
  email: string
): AdminClientAccountRecord | null {
  const target = normalizeAccountEmail(email);
  return records.find((record) => normalizeAccountEmail(record.email) === target) ?? null;
}

export type { AdminSubscriptionStatus };

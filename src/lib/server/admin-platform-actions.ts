"use server";

import { revalidatePath } from "next/cache";
import { getPlatformAdminAccess } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import {
  cancelAdminSubscriptionSchema,
  createAdminPlanSchema,
  createAdminSubscriptionSchema,
  deleteAdminPlanSchema,
  setAdminPlanActiveSchema,
  updateAdminPlanSchema,
  updateAdminSubscriptionPeriodSchema,
  updateAdminSubscriptionPlanSchema,
  updateAdminSubscriptionStatusSchema,
} from "@/lib/validation/schemas";

export type AdminActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

function revalidateAdminPaths(organizationId?: string): void {
  revalidatePath("/admin");
  revalidatePath("/admin/assinaturas");
  revalidatePath("/admin/planos");
  if (organizationId) {
    revalidatePath(`/admin/assinaturas/${organizationId}`);
  }
}

function mapWriteError(error: { code?: string; message?: string } | null): string {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();

  if (code === "42501" || message.includes("permission denied") || message.includes("row-level security")) {
    return "forbidden";
  }
  if (code === "23505" || message.includes("subscriptions_one_open_per_org")) {
    return "open_subscription_exists";
  }
  if (
    code === "23503" ||
    message.includes("plan_in_use") ||
    message.includes("subscriptions_plan_id_fkey")
  ) {
    return "plan_in_use";
  }
  if (
    code === "23514" ||
    message.includes("subscriptions_period_valid") ||
    message.includes("subscriptions_cancelled_state")
  ) {
    return "constraint_violation";
  }
  if (code === "23502") {
    return "constraint_violation";
  }
  return "unavailable";
}

async function requirePlatformAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const access = await getPlatformAdminAccess();
  if (!access) return { ok: false, error: "forbidden" };
  return { ok: true, userId: access.userId };
}

function asAmountNumber(value: string): number {
  return Number(value);
}

function isCancelledStatus(status: string): boolean {
  return status === "canceled" || status === "cancelled";
}

export async function createAdminSubscriptionAction(
  raw: unknown
): Promise<AdminActionResult> {
  const auth = await requirePlatformAdmin();
  if (!auth.ok) return auth;

  const parsed = createAdminSubscriptionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "validation_failed" };

  try {
    const supabase = await createClient();
    const { data: plan, error: planError } = await supabase
      .from("plans")
      .select("id, amount, currency, is_active")
      .eq("id", parsed.data.plan_id)
      .maybeSingle();

    if (planError) return { ok: false, error: mapWriteError(planError) };
    if (!plan) return { ok: false, error: "plan_not_found" };
    if (!plan.is_active) return { ok: false, error: "plan_inactive" };

    const { data: organization, error: orgError } = await supabase
      .from("organizations")
      .select("id")
      .eq("id", parsed.data.org_id)
      .maybeSingle();

    if (orgError) return { ok: false, error: mapWriteError(orgError) };
    if (!organization) return { ok: false, error: "organization_not_found" };

    const contractedAmount = parsed.data.contracted_amount
      ? asAmountNumber(parsed.data.contracted_amount)
      : Number(plan.amount);

    const { data, error } = await supabase
      .from("subscriptions")
      .insert({
        org_id: parsed.data.org_id,
        plan_id: parsed.data.plan_id,
        status: parsed.data.status,
        contracted_amount: contractedAmount,
        currency: plan.currency,
        period_start: parsed.data.period_start,
        period_end: parsed.data.period_end,
        cancelled_at: null,
      })
      .select("id")
      .single();

    if (error) return { ok: false, error: mapWriteError(error) };

    revalidateAdminPaths(parsed.data.org_id);
    return { ok: true, id: data.id };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function updateAdminSubscriptionPlanAction(
  raw: unknown
): Promise<AdminActionResult> {
  const auth = await requirePlatformAdmin();
  if (!auth.ok) return auth;

  const parsed = updateAdminSubscriptionPlanSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "validation_failed" };

  try {
    const supabase = await createClient();
    const { data: subscription, error: subscriptionError } = await supabase
      .from("subscriptions")
      .select("id, org_id, status")
      .eq("id", parsed.data.subscription_id)
      .maybeSingle();

    if (subscriptionError) return { ok: false, error: mapWriteError(subscriptionError) };
    if (!subscription) return { ok: false, error: "subscription_not_found" };
    if (isCancelledStatus(subscription.status)) {
      return { ok: false, error: "subscription_cancelled" };
    }

    const { data: plan, error: planError } = await supabase
      .from("plans")
      .select("id, amount, currency, is_active")
      .eq("id", parsed.data.plan_id)
      .maybeSingle();

    if (planError) return { ok: false, error: mapWriteError(planError) };
    if (!plan) return { ok: false, error: "plan_not_found" };
    if (!plan.is_active) return { ok: false, error: "plan_inactive" };

    const contractedAmount = parsed.data.contracted_amount
      ? asAmountNumber(parsed.data.contracted_amount)
      : Number(plan.amount);

    const { error } = await supabase
      .from("subscriptions")
      .update({
        plan_id: parsed.data.plan_id,
        contracted_amount: contractedAmount,
        currency: plan.currency,
      })
      .eq("id", parsed.data.subscription_id);

    if (error) return { ok: false, error: mapWriteError(error) };

    revalidateAdminPaths(subscription.org_id);
    return { ok: true, id: parsed.data.subscription_id };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function updateAdminSubscriptionStatusAction(
  raw: unknown
): Promise<AdminActionResult> {
  const auth = await requirePlatformAdmin();
  if (!auth.ok) return auth;

  const parsed = updateAdminSubscriptionStatusSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "validation_failed" };

  try {
    const supabase = await createClient();
    const { data: subscription, error: subscriptionError } = await supabase
      .from("subscriptions")
      .select("id, org_id, status")
      .eq("id", parsed.data.subscription_id)
      .maybeSingle();

    if (subscriptionError) return { ok: false, error: mapWriteError(subscriptionError) };
    if (!subscription) return { ok: false, error: "subscription_not_found" };
    if (isCancelledStatus(subscription.status)) {
      return { ok: false, error: "subscription_cancelled" };
    }

    const { error } = await supabase
      .from("subscriptions")
      .update({
        status: parsed.data.status,
        cancelled_at: null,
      })
      .eq("id", parsed.data.subscription_id);

    if (error) return { ok: false, error: mapWriteError(error) };

    revalidateAdminPaths(subscription.org_id);
    return { ok: true, id: parsed.data.subscription_id };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function updateAdminSubscriptionPeriodAction(
  raw: unknown
): Promise<AdminActionResult> {
  const auth = await requirePlatformAdmin();
  if (!auth.ok) return auth;

  const parsed = updateAdminSubscriptionPeriodSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "validation_failed" };

  try {
    const supabase = await createClient();
    const { data: subscription, error: subscriptionError } = await supabase
      .from("subscriptions")
      .select("id, org_id, status")
      .eq("id", parsed.data.subscription_id)
      .maybeSingle();

    if (subscriptionError) return { ok: false, error: mapWriteError(subscriptionError) };
    if (!subscription) return { ok: false, error: "subscription_not_found" };
    if (isCancelledStatus(subscription.status)) {
      return { ok: false, error: "subscription_cancelled" };
    }

    const { error } = await supabase
      .from("subscriptions")
      .update({
        period_start: parsed.data.period_start,
        period_end: parsed.data.period_end,
      })
      .eq("id", parsed.data.subscription_id);

    if (error) return { ok: false, error: mapWriteError(error) };

    revalidateAdminPaths(subscription.org_id);
    return { ok: true, id: parsed.data.subscription_id };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function cancelAdminSubscriptionAction(
  raw: unknown
): Promise<AdminActionResult> {
  const auth = await requirePlatformAdmin();
  if (!auth.ok) return auth;

  const parsed = cancelAdminSubscriptionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "validation_failed" };

  try {
    const supabase = await createClient();
    const { data: subscription, error: subscriptionError } = await supabase
      .from("subscriptions")
      .select("id, org_id, status")
      .eq("id", parsed.data.subscription_id)
      .maybeSingle();

    if (subscriptionError) return { ok: false, error: mapWriteError(subscriptionError) };
    if (!subscription) return { ok: false, error: "subscription_not_found" };
    if (isCancelledStatus(subscription.status)) {
      return { ok: false, error: "subscription_cancelled" };
    }

    const { error } = await supabase
      .from("subscriptions")
      .update({
        status: "canceled",
        cancelled_at: new Date().toISOString(),
      })
      .eq("id", parsed.data.subscription_id);

    if (error) return { ok: false, error: mapWriteError(error) };

    revalidateAdminPaths(subscription.org_id);
    return { ok: true, id: parsed.data.subscription_id };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function createAdminPlanAction(raw: unknown): Promise<AdminActionResult> {
  const auth = await requirePlatformAdmin();
  if (!auth.ok) return auth;

  const parsed = createAdminPlanSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "validation_failed" };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("plans")
      .insert({
        name: parsed.data.name,
        description: parsed.data.description ?? "",
        amount: asAmountNumber(parsed.data.amount),
        currency: "BRL",
        billing_interval: parsed.data.billing_interval,
        is_active: parsed.data.is_active ?? true,
      })
      .select("id")
      .single();

    if (error) return { ok: false, error: mapWriteError(error) };

    revalidateAdminPaths();
    return { ok: true, id: data.id };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function updateAdminPlanAction(raw: unknown): Promise<AdminActionResult> {
  const auth = await requirePlatformAdmin();
  if (!auth.ok) return auth;

  const parsed = updateAdminPlanSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "validation_failed" };

  try {
    const supabase = await createClient();
    const { data: existing, error: existingError } = await supabase
      .from("plans")
      .select("id")
      .eq("id", parsed.data.plan_id)
      .maybeSingle();

    if (existingError) return { ok: false, error: mapWriteError(existingError) };
    if (!existing) return { ok: false, error: "plan_not_found" };

    const { error } = await supabase
      .from("plans")
      .update({
        name: parsed.data.name,
        description: parsed.data.description ?? "",
        amount: asAmountNumber(parsed.data.amount),
        billing_interval: parsed.data.billing_interval,
      })
      .eq("id", parsed.data.plan_id);

    if (error) return { ok: false, error: mapWriteError(error) };

    revalidateAdminPaths();
    return { ok: true, id: parsed.data.plan_id };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function setAdminPlanActiveAction(raw: unknown): Promise<AdminActionResult> {
  const auth = await requirePlatformAdmin();
  if (!auth.ok) return auth;

  const parsed = setAdminPlanActiveSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "validation_failed" };

  try {
    const supabase = await createClient();
    const { data: existing, error: existingError } = await supabase
      .from("plans")
      .select("id")
      .eq("id", parsed.data.plan_id)
      .maybeSingle();

    if (existingError) return { ok: false, error: mapWriteError(existingError) };
    if (!existing) return { ok: false, error: "plan_not_found" };

    const { error } = await supabase
      .from("plans")
      .update({ is_active: parsed.data.is_active })
      .eq("id", parsed.data.plan_id);

    if (error) return { ok: false, error: mapWriteError(error) };

    revalidateAdminPaths();
    return { ok: true, id: parsed.data.plan_id };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function deleteAdminPlanAction(raw: unknown): Promise<AdminActionResult> {
  const auth = await requirePlatformAdmin();
  if (!auth.ok) return auth;

  const parsed = deleteAdminPlanSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "validation_failed" };

  try {
    const supabase = await createClient();
    const { count, error: countError } = await supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", parsed.data.plan_id);

    if (countError) return { ok: false, error: mapWriteError(countError) };
    if ((count ?? 0) > 0) return { ok: false, error: "plan_in_use" };

    const { error } = await supabase.from("plans").delete().eq("id", parsed.data.plan_id);
    if (error) return { ok: false, error: mapWriteError(error) };

    revalidateAdminPaths();
    return { ok: true, id: parsed.data.plan_id };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

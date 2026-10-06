"use server";

import { revalidatePath } from "next/cache";
import { getPlatformAdminAccess } from "@/lib/auth/admin";
import { reviewRefundRequestSchema } from "@/lib/validation/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRefundRequestStore, reviewRefundRequest } from "@/lib/server/refund-requests";

export type RefundReviewActionResult =
  | { ok: true; id: string; status: string }
  | { ok: false; error: string };

export async function reviewRefundRequestAction(raw: unknown): Promise<RefundReviewActionResult> {
  const access = await getPlatformAdminAccess();
  if (!access) return { ok: false, error: "forbidden" };

  const parsed = reviewRefundRequestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "validation_failed" };

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "service_role_unavailable" };

  try {
    const result = await reviewRefundRequest(createRefundRequestStore(admin), {
      id: parsed.data.id,
      action: parsed.data.action,
      resolutionNote: parsed.data.resolution_note,
      acknowledgeOutsideWindow: parsed.data.acknowledge_outside_window,
      reviewerId: access.userId,
    });
    if (!result.ok) return result;
    revalidatePath("/admin/reembolsos");
    return result;
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

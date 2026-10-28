"use server";

import { revalidatePath } from "next/cache";
import { getPlatformAdminAccess } from "@/lib/auth/admin";
import { reviewRefundRequestSchema } from "@/lib/validation/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import {
  createRefundRequestStore,
  reconcileUnknownRefundRequest,
  reviewRefundRequest,
} from "@/lib/server/refund-requests";

// Temporary local schema: the coordinator should move it to src/lib/validation/schemas.ts.
const reconcileUnknownRefundRequestSchema = z.object({
  id: z.string().uuid(),
  outcome: z.enum(["refunded", "not_refunded"]),
  evidence_note: z.string().trim().min(3).max(2000),
  provider_refund_id: z.string().trim().max(20).optional().default(""),
});

export type RefundReviewActionResult =
  | { ok: true; id: string; status: string }
  | { ok: false; error: string; message?: string };

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

/** Manual reconciliation of an unknown outcome. Does not call Mercado Pago. */
export async function reconcileUnknownRefundRequestAction(raw: unknown): Promise<RefundReviewActionResult> {
  const access = await getPlatformAdminAccess();
  if (!access) return { ok: false, error: "forbidden" };

  const parsed = reconcileUnknownRefundRequestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "validation_failed" };

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "service_role_unavailable" };

  try {
    const result = await reconcileUnknownRefundRequest(createRefundRequestStore(admin), {
      id: parsed.data.id,
      outcome: parsed.data.outcome,
      evidenceNote: parsed.data.evidence_note,
      providerRefundId: parsed.data.provider_refund_id || null,
      reviewerId: access.userId,
    });
    if (!result.ok) return result;
    revalidatePath("/admin/reembolsos");
    return result;
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

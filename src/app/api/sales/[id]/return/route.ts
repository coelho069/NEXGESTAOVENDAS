import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import { resolvePixExternalRefundOutcome } from "@/lib/domain/payment";
import { canCancelSale, canReturnSale } from "@/lib/domain/sale-return";
import { saleCancelInputSchema, saleReturnInputSchema } from "@/lib/validation/schemas";

function enrichReturnPayload(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const row = data as Record<string, unknown>;
  if (row.payment_method !== "pix") return data;
  const pixRefund = resolvePixExternalRefundOutcome();
  return {
    ...row,
    // Never claim an external PIX refund completed without a live provider.
    pix_refund: {
      status: pixRefund.status,
      payment_refund_status: row.payment_refund_status ?? pixRefund.paymentRefundStatus,
      message: pixRefund.message,
    },
  };
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

function mapReturnError(error: { message?: string; code?: string }) {
  const message = error.message ?? "";
  if (message.includes("forbidden_sale_cancel") || message.includes("forbidden_sale_return")) {
    return NextResponse.json({ error: "forbidden_sale_return" }, { status: 403 });
  }
  if (message.includes("sale_not_found") || message.includes("sale_item_not_found")) {
    return NextResponse.json({ error: "sale_not_found" }, { status: 404 });
  }
  if (message.includes("idempotency_payload_mismatch")) {
    return NextResponse.json({ error: "idempotency_payload_mismatch" }, { status: 409 });
  }
  if (
    message.includes("sale_not_cancellable") ||
    message.includes("sale_not_returnable") ||
    message.includes("sale_return_quantity_exceeded") ||
    message.includes("sale_return_amount_exceeded") ||
    message.includes("sale_cancel_requires_all_items") ||
    message.includes("cash_session") ||
    message.includes("invalid_sale_return") ||
    message.includes("duplicate_sale_return_item")
  ) {
    return NextResponse.json(
      {
        error: message.includes("cash_session")
          ? "cash_session_required"
          : message.includes("quantity_exceeded")
            ? "sale_return_quantity_exceeded"
            : message.includes("not_cancellable") || message.includes("not_returnable")
              ? "sale_not_returnable"
              : "sale_return_validation_failed",
        message,
      },
      { status: 422 }
    );
  }
  return NextResponse.json({ error: "sale_return_unavailable" }, { status: 503 });
}

export async function POST(request: Request, context: RouteContext) {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: saleId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const withSaleId =
    body && typeof body === "object" ? { ...(body as Record<string, unknown>), sale_id: saleId } : body;

  const isCancel =
    withSaleId &&
    typeof withSaleId === "object" &&
    "operation" in withSaleId &&
    (withSaleId as { operation?: unknown }).operation === "cancel";

  if (isCancel) {
    const parsed = saleCancelInputSchema.safeParse(withSaleId);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const auth = await getAuthedContext(parsed.data.store_id);
    if (!auth?.orgId || !auth.role || !canCancelSale(auth.role)) {
      return NextResponse.json({ error: "forbidden_sale_return" }, { status: 403 });
    }
    const { data, error } = await supabase.rpc("cancel_sale", {
      p_payload: parsed.data,
    });
    if (error) return mapReturnError(error);
    return NextResponse.json(enrichReturnPayload(data), { status: 201 });
  }

  const parsed = saleReturnInputSchema.safeParse(withSaleId);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.orgId || !auth.role || !canReturnSale(auth.role)) {
    return NextResponse.json({ error: "forbidden_sale_return" }, { status: 403 });
  }

  const { data, error } = await supabase.rpc("process_sale_return", {
    p_payload: parsed.data,
  });
  if (error) return mapReturnError(error);
  return NextResponse.json(enrichReturnPayload(data), { status: 201 });
}

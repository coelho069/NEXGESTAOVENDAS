import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { processSaleInputSchema } from "@/lib/validation/schemas";
import { getAuthedContext } from "@/lib/auth/session";
import { resolveStoreRole } from "@/lib/auth/authorization";
import { discountLimitHttpStatus, salePayloadExceedsDiscountCap } from "@/lib/domain/sale-ops";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = processSaleInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const hasNonCash = parsed.data.payments.some((payment) => payment.method !== "cash");
  if (hasNonCash) {
    return NextResponse.json(
      { error: "payment_method_not_configured", adapter_status: "not_configured" },
      { status: 422 }
    );
  }

  const auth = await getAuthedContext();
  if (!auth?.orgId) {
    return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
  }

  const role = await resolveStoreRole(supabase, {
    userId: user.id,
    orgId: auth.orgId,
    storeId: parsed.data.store_id,
  });
  if (!role) {
    return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
  }

  if (salePayloadExceedsDiscountCap(parsed.data, role)) {
    return NextResponse.json({ error: "discount_limit_exceeded" }, { status: discountLimitHttpStatus(true) });
  }

  const { data, error } = await supabase.rpc("process_sale", {
    p_payload: parsed.data,
  });

  if (error) {
    if (error.message.includes("idempotency_payload_mismatch")) {
      return NextResponse.json({ error: "idempotency_payload_mismatch" }, { status: 409 });
    }
    if (error.message.includes("discount_limit_exceeded")) {
      return NextResponse.json({ error: "discount_limit_exceeded" }, { status: 403 });
    }
    if (error.message.includes("forbidden") || error.message.includes("access_denied")) {
      return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
    }
    if (error.code === "22023" || error.code === "23514") {
      return NextResponse.json({ error: "sale_processing_failed" }, { status: 422 });
    }
    return NextResponse.json({ error: "sale_processing_unavailable" }, { status: 503 });
  }

  return NextResponse.json(data);
}

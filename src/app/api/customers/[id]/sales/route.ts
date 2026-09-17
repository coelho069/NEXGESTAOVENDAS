import { NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/auth/session";
import { canWriteCustomers } from "@/lib/domain/customer";
import { createClient } from "@/lib/supabase/server";
import { customerIdSchema, customerSalesListQuerySchema } from "@/lib/validation/schemas";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!customerIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Validation failed" }, { status: 400 });
  }

  const parsed = customerSalesListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const auth = await getAuthedContext();
  if (!canWriteCustomers(auth) || !auth?.orgId) {
    return NextResponse.json({ error: "forbidden_customers" }, { status: 403 });
  }

  const payload = {
    customer_id: id,
    limit: parsed.data.limit,
    ...(parsed.data.after_created_at && parsed.data.after_id
      ? {
          after_created_at: parsed.data.after_created_at,
          after_id: parsed.data.after_id,
        }
      : {}),
  };

  const { data, error } = await supabase.rpc("list_customer_sales", {
    p_payload: payload,
  });
  if (error) {
    const message = error.message ?? "";
    if (message.includes("customer_not_found") || error.code === "P0002") {
      return NextResponse.json({ error: "customer_not_found" }, { status: 404 });
    }
    if (message.includes("forbidden")) {
      return NextResponse.json({ error: "forbidden_customers" }, { status: 403 });
    }
    if (message.includes("invalid_customer_sales_query") || error.code === "22023") {
      return NextResponse.json({ error: "Validation failed" }, { status: 400 });
    }
    return NextResponse.json({ error: "customer_sales_unavailable" }, { status: 503 });
  }

  return NextResponse.json(data);
}

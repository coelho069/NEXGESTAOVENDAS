import { NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/auth/session";
import { canWriteCustomers } from "@/lib/domain/customer";
import { listCustomerSales } from "@/lib/server/list-customer-sales";
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

  const result = await listCustomerSales(supabase, {
    customerId: id,
    orgId: auth.orgId,
    limit: parsed.data.limit,
    afterCreatedAt: parsed.data.after_created_at,
    afterId: parsed.data.after_id,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.detail ? { detail: result.detail } : {}) },
      { status: result.status }
    );
  }

  return NextResponse.json(result.data);
}

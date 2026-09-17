import { NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/auth/session";
import { parseCatalogCustomer } from "@/lib/domain/customer";
import { resolveCustomerWriteContext } from "@/lib/server/customer-write-access";
import { createClient } from "@/lib/supabase/server";
import { customerIdSchema, customerWriteSchema } from "@/lib/validation/schemas";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = customerWriteSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const auth = await getAuthedContext();
  const writeContext = await resolveCustomerWriteContext(supabase, auth);
  if (!writeContext) {
    return NextResponse.json({ error: "forbidden_customers" }, { status: 403 });
  }

  const patch = {
    name: parsed.data.name,
    document: parsed.data.document,
    email: parsed.data.email,
  };

  const { data, error } = await supabase
    .from("customers")
    .update(patch)
    .eq("id", id)
    .eq("org_id", writeContext.orgId)
    .select("id, name, document, email")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "customer_write_failed" }, { status: 422 });
  }
  if (!data) {
    return NextResponse.json({ error: "customer_not_found" }, { status: 404 });
  }

  const customer = parseCatalogCustomer(data);
  if (!customer) {
    return NextResponse.json({ error: "customer_write_failed" }, { status: 422 });
  }

  return NextResponse.json(customer);
}

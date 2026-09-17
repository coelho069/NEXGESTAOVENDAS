import { NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/auth/session";
import { canWriteCustomers, parseCatalogCustomer } from "@/lib/domain/customer";
import { createClient } from "@/lib/supabase/server";
import { customerWriteSchema } from "@/lib/validation/schemas";

export async function POST(request: Request) {
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
  if (!canWriteCustomers(auth) || !auth?.orgId) {
    return NextResponse.json({ error: "forbidden_customers" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("customers")
    .insert({
      org_id: auth.orgId,
      name: parsed.data.name,
      document: parsed.data.document,
      email: parsed.data.email,
    })
    .select("id, name, document, email")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "customer_write_failed" }, { status: 422 });
  }

  const customer = parseCatalogCustomer(data);
  if (!customer) {
    return NextResponse.json({ error: "customer_write_failed" }, { status: 422 });
  }

  return NextResponse.json(customer, { status: 201 });
}

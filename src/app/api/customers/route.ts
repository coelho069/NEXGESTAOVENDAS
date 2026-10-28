import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { customerWriteSchema } from "@/lib/validation/schemas";
import { getAuthedContext } from "@/lib/auth/session";
import { canEditCustomers } from "@/lib/domain/rbac";

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = customerWriteSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await getAuthedContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!auth.orgId || !auth.role || !canEditCustomers(auth.role)) {
    return NextResponse.json({ error: "forbidden_customers" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .insert({
      org_id: auth.orgId,
      name: parsed.data.name,
      document: parsed.data.document ?? null,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email ?? null,
      age: parsed.data.age ?? null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "customer_write_failed", detail: error.message }, { status: 422 });
  }

  return NextResponse.json(data, { status: 201 });
}

export async function GET() {
  const auth = await getAuthedContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!auth.orgId) {
    return NextResponse.json({ error: "forbidden_customers" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("id, name, document, phone, email, age")
    .eq("org_id", auth.orgId)
    .order("name");

  if (error) {
    return NextResponse.json({ error: "customer_read_failed" }, { status: 422 });
  }

  return NextResponse.json(data);
}

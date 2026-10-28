import { NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/auth/session";
import { canWriteCustomers, parseCatalogCustomer } from "@/lib/domain/customer";
import {
  loadCustomerDiscountLimits,
  saveCustomerDiscountLimit,
} from "@/lib/server/customer-discount-limits";
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
  if (!canWriteCustomers(auth) || !auth?.orgId) {
    return NextResponse.json({ error: "forbidden_customers" }, { status: 403 });
  }

  const patch = {
    name: parsed.data.name,
    document: parsed.data.document,
    email: parsed.data.email,
    age: parsed.data.age,
  };

  const { data, error } = await supabase
    .from("customers")
    .update(patch)
    .eq("id", id)
    .eq("org_id", auth.orgId)
    .select("id, name, document, email, age")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "customer_write_failed" }, { status: 422 });
  }
  if (!data) {
    return NextResponse.json({ error: "customer_not_found" }, { status: 404 });
  }

  await saveCustomerDiscountLimit(auth.orgId, id, parsed.data.discount_limit);

  const customer = parseCatalogCustomer({
    ...data,
    discount_limit: parsed.data.discount_limit,
  });
  if (!customer) {
    return NextResponse.json({ error: "customer_write_failed" }, { status: 422 });
  }

  return NextResponse.json(customer);
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const auth = await getAuthedContext();
  if (!auth?.orgId) {
    return NextResponse.json({ error: "forbidden_customers" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("customers")
    .select("id, name, document, email, age")
    .eq("id", id)
    .eq("org_id", auth.orgId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "customer_read_failed" }, { status: 422 });
  }
  if (!data) {
    return NextResponse.json({ error: "customer_not_found" }, { status: 404 });
  }

  const limits = await loadCustomerDiscountLimits(auth.orgId);
  const customer = parseCatalogCustomer({
    ...data,
    discount_limit: limits[id] ?? null,
  });
  if (!customer) {
    return NextResponse.json({ error: "customer_read_failed" }, { status: 422 });
  }
  return NextResponse.json(customer);
}

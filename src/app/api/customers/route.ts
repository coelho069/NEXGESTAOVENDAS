import { NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/auth/session";
import { canWriteCustomers, parseCatalogCustomer } from "@/lib/domain/customer";
import {
  loadCustomerDiscountLimits,
  saveCustomerDiscountLimit,
} from "@/lib/server/customer-discount-limits";
import { createClient } from "@/lib/supabase/server";
import { customerWriteSchema } from "@/lib/validation/schemas";

/**
 * Lista clientes da org do usuário. Lê pela sessão do servidor (cookie httpOnly):
 * o navegador não enxerga esse JWT, então a consulta direta via anon key devolvia 401.
 */
export async function GET() {
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

  const auth = await getAuthedContext();
  if (!auth?.orgId) {
    return NextResponse.json({ error: "forbidden_customers" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("customers")
    .select("id, name, document, email, age")
    .order("name");

  if (error || !data) {
    return NextResponse.json({ error: "customer_read_failed" }, { status: 422 });
  }

  const limits = await loadCustomerDiscountLimits(auth.orgId);
  const customers = data
    .map((row) =>
      parseCatalogCustomer({
        ...row,
        discount_limit: limits[row.id] ?? null,
      })
    )
    .filter((customer) => customer !== null);

  return NextResponse.json(customers);
}

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
      age: parsed.data.age,
    })
    .select("id, name, document, email, age")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "customer_write_failed" }, { status: 422 });
  }

  await saveCustomerDiscountLimit(auth.orgId, data.id, parsed.data.discount_limit);

  const customer = parseCatalogCustomer({
    ...data,
    discount_limit: parsed.data.discount_limit,
  });
  if (!customer) {
    return NextResponse.json({ error: "customer_write_failed" }, { status: 422 });
  }

  return NextResponse.json(customer, { status: 201 });
}

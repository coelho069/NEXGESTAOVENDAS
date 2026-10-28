import { NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/auth/session";
import { canWriteCustomers, parseCatalogCustomer } from "@/lib/domain/customer";
import {
  buildAnonymizedCustomerPatch,
  isAnonymizedCustomerName,
} from "@/lib/domain/customer-lgpd";
import { saveCustomerDiscountLimit } from "@/lib/server/customer-discount-limits";
import { createClient } from "@/lib/supabase/server";
import { customerIdSchema } from "@/lib/validation/schemas";

/**
 * Anonimiza identificadores diretos do cliente (nome/documento/e-mail).
 * DELETE direto em customers é revogado no RLS; mantemos a linha por FK de vendas.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  if (!canWriteCustomers(auth) || !auth?.orgId) {
    return NextResponse.json({ error: "forbidden_customers" }, { status: 403 });
  }

  const { data: existing, error: readError } = await supabase
    .from("customers")
    .select("id, name, document, email")
    .eq("id", id)
    .eq("org_id", auth.orgId)
    .maybeSingle();

  if (readError) {
    return NextResponse.json({ error: "customer_read_failed" }, { status: 422 });
  }
  if (!existing) {
    return NextResponse.json({ error: "customer_not_found" }, { status: 404 });
  }

  if (isAnonymizedCustomerName(existing.name) && !existing.document && !existing.email) {
    const already = parseCatalogCustomer(existing);
    if (!already) {
      return NextResponse.json({ error: "customer_write_failed" }, { status: 422 });
    }
    return NextResponse.json({ customer: already, already_anonymized: true });
  }

  const patch = buildAnonymizedCustomerPatch();
  const { data, error } = await supabase
    .from("customers")
    // discount_limit exists in DB; generated Database types omit it.
    .update(patch as never)
    .eq("id", id)
    .eq("org_id", auth.orgId)
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

  await saveCustomerDiscountLimit(auth.orgId, id, null);
  return NextResponse.json({ customer: { ...customer, discountLimit: null }, already_anonymized: false });
}

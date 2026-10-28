import { NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/auth/session";
import { canWriteCustomers, parseCatalogCustomer } from "@/lib/domain/customer";
import type { CustomerLgpdExportPayload } from "@/lib/domain/customer-lgpd";
import { createClient } from "@/lib/supabase/server";
import { listCustomerSales } from "@/lib/server/list-customer-sales";
import { customerIdSchema } from "@/lib/validation/schemas";

/**
 * Exporta cadastro + histórico de vendas do cliente (pedido de acesso/portabilidade da loja).
 */
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
  if (!canWriteCustomers(auth) || !auth?.orgId) {
    return NextResponse.json({ error: "forbidden_customers" }, { status: 403 });
  }

  const { data: row, error: customerError } = await supabase
    .from("customers")
    .select("id, name, document, email")
    .eq("id", id)
    .eq("org_id", auth.orgId)
    .maybeSingle();

  if (customerError) {
    return NextResponse.json({ error: "customer_read_failed" }, { status: 422 });
  }
  if (!row) {
    return NextResponse.json({ error: "customer_not_found" }, { status: 404 });
  }

  const customer = parseCatalogCustomer(row);
  if (!customer) {
    return NextResponse.json({ error: "customer_read_failed" }, { status: 422 });
  }

  const result = await listCustomerSales(supabase, {
    customerId: id,
    orgId: auth.orgId,
    limit: 100,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const payload: CustomerLgpdExportPayload = {
    exported_at: new Date().toISOString(),
    purpose: "lgpd_data_subject_export",
    notice:
      "Exportação gerada pela loja para atender pedido do titular. Revise antes de enviar e não compartilhe com terceiros sem base legal.",
    customer: {
      id: customer.id,
      name: customer.name,
      document: customer.document,
      email: customer.email,
    },
    sales: result.data,
  };

  const filename = `cliente-${customer.id}-lgpd-export.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

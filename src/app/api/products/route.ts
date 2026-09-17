import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { productWriteSchema } from "@/lib/validation/schemas";
import { getAuthedContext } from "@/lib/auth/session";
import { resolveOrganizationRole } from "@/lib/auth/authorization";
import { canEditProducts } from "@/lib/domain/rbac";
import type { Database } from "@/lib/db/types";

export async function POST(request: Request) {
  const auth = await getAuthedContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = productWriteSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createClient();
  const role = await resolveOrganizationRole(supabase, {
    userId: auth.userId,
    orgId: auth.orgId,
  });
  if (!role || !canEditProducts(role) || !auth.orgId) {
    return NextResponse.json({ error: "forbidden_products" }, { status: 403 });
  }

  const productInsert = {
    org_id: auth.orgId,
    sku: parsed.data.sku,
    name: parsed.data.name,
    unit_price: parsed.data.unit_price,
    cost_price: parsed.data.cost_price,
    barcode: parsed.data.barcode ?? null,
    is_active: parsed.data.is_active,
    category_id: parsed.data.category_id ?? null,
  } as unknown as Database["public"]["Tables"]["products"]["Insert"];

  const { data, error } = await supabase
    .from("products")
    .insert(productInsert)
    .select("id, sku")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "product_write_failed" }, { status: 422 });
  }

  return NextResponse.json(data, { status: 201 });
}
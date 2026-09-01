import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { productWriteSchema } from "@/lib/validation/schemas";
import { getAuthedContext } from "@/lib/auth/session";
import { canEditProducts } from "@/lib/domain/rbac";

export async function POST(request: Request) {
  const auth = await getAuthedContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canEditProducts(auth.role) || !auth.orgId) {
    return NextResponse.json({ error: "forbidden_products" }, { status: 403 });
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
  const { data, error } = await supabase
    .from("products")
    .insert({
      org_id: auth.orgId,
      sku: parsed.data.sku,
      name: parsed.data.name,
      unit_price: Number(parsed.data.unit_price),
      cost_price: Number(parsed.data.cost_price),
      barcode: parsed.data.barcode ?? null,
      is_active: parsed.data.is_active,
      category_id: parsed.data.category_id ?? null,
    })
    .select("id, sku")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 422 });
  }

  return NextResponse.json(data, { status: 201 });
}
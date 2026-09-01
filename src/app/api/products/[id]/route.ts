import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { productPatchSchema } from "@/lib/validation/schemas";
import { getAuthedContext } from "@/lib/auth/session";
import { canEditProducts } from "@/lib/domain/rbac";
import type { Database } from "@/lib/db/types";

type ProductUpdate = Database["public"]["Tables"]["products"]["Update"];

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
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

  const parsed = productPatchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const patch = parsed.data;
  const update: ProductUpdate = {};
  if (patch.sku !== undefined) update.sku = patch.sku;
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.unit_price !== undefined) update.unit_price = Number(patch.unit_price);
  if (patch.cost_price !== undefined) update.cost_price = Number(patch.cost_price);
  if (patch.barcode !== undefined) update.barcode = patch.barcode;
  if (patch.is_active !== undefined) update.is_active = patch.is_active;
  if (patch.category_id !== undefined) update.category_id = patch.category_id;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "empty_patch" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .update(update)
    .eq("id", params.id)
    .eq("org_id", auth.orgId)
    .select("id, sku")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  if (!data) {
    return NextResponse.json({ error: "product_not_found" }, { status: 404 });
  }

  return NextResponse.json(data);
}

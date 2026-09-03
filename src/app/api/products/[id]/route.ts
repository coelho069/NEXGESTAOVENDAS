import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { productPatchSchema, storeIdSchema } from "@/lib/validation/schemas";
import { getAuthedContext } from "@/lib/auth/session";
import { canEditProducts } from "@/lib/domain/rbac";
import { asCatalogClient } from "@/lib/db/catalog-rpc";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const requestedStoreId =
    json && typeof json === "object" && "store_id" in json
      ? (json as { store_id?: unknown }).store_id
      : undefined;
  if (!storeIdSchema.safeParse(requestedStoreId).success) {
    return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
  }

  const parsed = productPatchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const { store_id: storeId, ...patch } = parsed.data;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "empty_patch" }, { status: 400 });
  }

  const auth = await getAuthedContext(storeId);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!auth.role || !canEditProducts(auth.role)) {
    return NextResponse.json({ error: "forbidden_products" }, { status: 403 });
  }

  const { id } = await params;
  const patchPayload = {
    ...(patch.sku !== undefined ? { sku: patch.sku } : {}),
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.unit_price !== undefined ? { unit_price: patch.unit_price } : {}),
    ...(patch.cost_price !== undefined ? { cost_price: patch.cost_price } : {}),
    ...(patch.barcode !== undefined ? { barcode: patch.barcode } : {}),
    ...(patch.is_active !== undefined ? { is_active: patch.is_active } : {}),
    ...(patch.category_id !== undefined ? { category_id: patch.category_id } : {}),
  };
  const supabase = asCatalogClient(await createClient());
  const { data, error } = await supabase.rpc("update_product", {
    p_store_id: storeId,
    p_product_id: id,
    p_payload: patchPayload,
  });

  if (error) {
    if (error.message.includes("forbidden_catalog")) {
      return NextResponse.json({ error: "forbidden_products" }, { status: 403 });
    }
    if (error.message.includes("product_not_found")) {
      return NextResponse.json({ error: "product_not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "product_write_failed" }, { status: 422 });
  }

  return NextResponse.json(data);
}

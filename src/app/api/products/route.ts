import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { productWriteSchema, storeIdSchema } from "@/lib/validation/schemas";
import { getAuthedContext } from "@/lib/auth/session";
import { canEditProducts } from "@/lib/domain/rbac";
import { asCatalogClient } from "@/lib/db/catalog-rpc";

export async function POST(request: Request) {
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

  const parsed = productWriteSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    !auth.orgId ||
    !auth.storeId ||
    auth.storeId !== parsed.data.store_id ||
    !auth.role ||
    !canEditProducts(auth.role)
  ) {
    return NextResponse.json({ error: "forbidden_products" }, { status: 403 });
  }

  const supabase = asCatalogClient(await createClient());
  const { data, error } = await supabase.rpc("create_product", {
    p_store_id: auth.storeId,
    p_payload: {
      sku: parsed.data.sku,
      name: parsed.data.name,
      unit_price: parsed.data.unit_price,
      cost_price: parsed.data.cost_price,
      barcode: parsed.data.barcode ?? null,
      is_active: parsed.data.is_active,
      category_id: parsed.data.category_id ?? null,
    },
  });

  if (error) {
    if (error.message.includes("forbidden_catalog")) {
      return NextResponse.json({ error: "forbidden_products" }, { status: 403 });
    }
    if (
      error.code === "23505" &&
      `${error.message} ${error.details ?? ""}`.includes("products_org_barcode_key")
    ) {
      return NextResponse.json({ error: "barcode_conflict" }, { status: 409 });
    }
    return NextResponse.json({ error: "product_write_failed" }, { status: 422 });
  }

  return NextResponse.json(data, { status: 201 });
}
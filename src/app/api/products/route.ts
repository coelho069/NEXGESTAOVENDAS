import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { productWriteSchema, storeIdSchema } from "@/lib/validation/schemas";
import { getAuthedContext } from "@/lib/auth/session";
import { canEditProducts } from "@/lib/domain/rbac";
import { asCatalogClient } from "@/lib/db/catalog-rpc";
import { applyCatalogQuantity } from "@/lib/server/catalog-quantity";
import { parseCatalogProduct } from "@/lib/domain/product";

/**
 * Lista produtos ativos da org do usuário. Lê pela sessão do servidor (cookie httpOnly):
 * o navegador não enxerga esse JWT, então a consulta direta via anon key devolvia 401.
 * A RLS (products_select_active) continua limitando a org.
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

  const { data, error } = await supabase
    .from("products")
    .select("id, sku, name, unit_price, barcode, category_id, is_active")
    .eq("is_active", true)
    .order("name");

  if (error || !data) {
    return NextResponse.json({ error: "product_read_failed" }, { status: 422 });
  }

  const products = data.map((row) => parseCatalogProduct(row));
  return NextResponse.json(products.filter((product) => product !== null));
}

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

  const supabase = await createClient();
  const { data, error } = await asCatalogClient(supabase).rpc("create_product", {
    p_store_id: auth.storeId,
    p_payload: {
      sku: parsed.data.sku,
      name: parsed.data.name,
      unit_price: parsed.data.unit_price,
      cost_price: auth.role === "client" ? "0.00" : parsed.data.cost_price,
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

  const created = data as { id?: string; sku?: string } | null;
  const productId = created?.id;
  if (!productId) {
    return NextResponse.json({ error: "product_write_failed" }, { status: 422 });
  }
  const stock = await applyCatalogQuantity(supabase, {
    storeId: auth.storeId,
    productId,
    quantity: parsed.data.quantity,
    currentQuantity: "0.000",
    reason: "cadastro do produto",
  });
  if ("error" in stock) {
    return NextResponse.json(
      { error: stock.error, id: productId, sku: created.sku },
      { status: 422 }
    );
  }

  return NextResponse.json({ ...created, quantity: stock.quantity }, { status: 201 });
}
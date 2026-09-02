import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { inventoryAdjustSchema } from "@/lib/validation/schemas";
import { getAuthedContext } from "@/lib/auth/session";
import { resolveStoreRole } from "@/lib/auth/authorization";
import { canManageInventory } from "@/lib/domain/rbac";

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

  const parsed = inventoryAdjustSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }
  if (!parsed.data.product_id && !parsed.data.sku) {
    return NextResponse.json({ error: "product_id_or_sku_required" }, { status: 400 });
  }

  const supabase = await createClient();
  const role = await resolveStoreRole(supabase, {
    userId: auth.userId,
    orgId: auth.orgId,
    storeId: parsed.data.store_id,
  });
  if (!role || !canManageInventory(role)) {
    return NextResponse.json({ error: "forbidden_inventory" }, { status: 403 });
  }

  let productId = parsed.data.product_id;
  if (!productId && parsed.data.sku) {
    let query = supabase.from("products").select("id").eq("sku", parsed.data.sku);
    if (auth.orgId) {
      query = query.eq("org_id", auth.orgId);
    }
    const { data: product } = await query.maybeSingle();
    productId = product?.id;
  }
  if (!productId) {
    return NextResponse.json({ error: "product_not_found" }, { status: 422 });
  }

  const { data, error } = await supabase.rpc("adjust_inventory", {
    p_payload: {
      store_id: parsed.data.store_id,
      product_id: productId,
      delta: parsed.data.delta,
      reason: parsed.data.reason,
      movement_type: parsed.data.movement_type,
    },
  });

  if (error) {
    const status = error.message.includes("forbidden") ? 403 : 422;
    return NextResponse.json({ error: status === 403 ? "forbidden_inventory" : "inventory_adjustment_failed" }, { status });
  }

  return NextResponse.json(data);
}
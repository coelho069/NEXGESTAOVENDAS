import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { inventoryAdjustSchema, storeIdSchema } from "@/lib/validation/schemas";
import { getAuthedContext } from "@/lib/auth/session";
import { canManageInventory } from "@/lib/domain/rbac";

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
  const storeIdResult = storeIdSchema.safeParse(requestedStoreId);
  if (!storeIdResult.success) {
    return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
  }

  const parsed = inventoryAdjustSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }
  if (!parsed.data.product_id && !parsed.data.sku) {
    return NextResponse.json({ error: "product_id_or_sku_required" }, { status: 400 });
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 });
  }
  const role = auth.role;
  const authorizedStoreId = auth.storeId;
  if (
    !auth.orgId ||
    !authorizedStoreId ||
    authorizedStoreId !== parsed.data.store_id ||
    !role ||
    !canManageInventory(role)
  ) {
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
      store_id: authorizedStoreId,
      product_id: productId,
      client_mutation_id: parsed.data.client_mutation_id,
      ...(parsed.data.terminal_id
        ? { terminal_id: parsed.data.terminal_id }
        : {}),
      ...(parsed.data.import_id
        ? {
            import_id: parsed.data.import_id,
            import_row: parsed.data.import_row,
          }
        : {}),
      delta: parsed.data.delta,
      reason: parsed.data.reason,
      movement_type: parsed.data.movement_type,
    },
  });

  if (error) {
    if (error.message.includes("idempotency_payload_mismatch")) {
      return NextResponse.json({ error: "idempotency_payload_mismatch" }, { status: 409 });
    }
    if (error.message.includes("forbidden")) {
      return NextResponse.json({ error: "forbidden_inventory" }, { status: 403 });
    }
    if (error.code === "23505") {
      return NextResponse.json({ error: "inventory_mutation_conflict" }, { status: 409 });
    }
    return NextResponse.json({ error: "inventory_adjustment_failed" }, { status: 422 });
  }

  return NextResponse.json(data);
}
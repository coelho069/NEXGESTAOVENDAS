import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { inventoryImportSchema, storeIdSchema } from "@/lib/validation/schemas";
import { getAuthedContext } from "@/lib/auth/session";
import { canManageInventory } from "@/lib/domain/rbac";
import { parseInventoryCsv } from "@/lib/domain/inventory";
import { inventoryImportMutationId } from "@/lib/server/inventory-idempotency";

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

  const parsed = inventoryImportSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  const authorizedStoreId = auth?.storeId;
  if (!auth?.orgId || !authorizedStoreId || authorizedStoreId !== parsed.data.store_id || !auth.role) {
    return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
  }

  const csv = parseInventoryCsv(parsed.data.csv);
  const supabase = await createClient();
  const role = auth.role;
  if (!role || !canManageInventory(role)) {
    return NextResponse.json({ error: "forbidden_inventory" }, { status: 403 });
  }

  const applied: Array<{ row: number; sku: string; movementId?: string; replay: boolean }> = [];
  const errors = [...csv.errors];
  let replayedCount = 0;

  for (const row of csv.rows) {
    const { data: product } = await supabase
      .from("products")
      .select("id")
      .eq("sku", row.sku)
      .eq("org_id", auth.orgId)
      .maybeSingle();
    if (!product) {
      errors.push({ row: row.row, sku: row.sku, message: "SKU não encontrado na organização" });
      continue;
    }

    const clientMutationId = inventoryImportMutationId(
      authorizedStoreId,
      parsed.data.import_id,
      row.row
    );
    const { data, error } = await supabase.rpc("adjust_inventory", {
      p_payload: {
        store_id: authorizedStoreId,
        product_id: product.id,
        client_mutation_id: clientMutationId,
        import_id: parsed.data.import_id,
        import_row: row.row,
        delta: row.delta,
        reason: row.reason,
        movement_type: row.movementType,
      },
    });

    if (error) {
      errors.push({ row: row.row, sku: row.sku, message: "Ajuste de inventário rejeitado" });
      continue;
    }

    const payload = data as { movement_id?: string; replay?: boolean } | null;
    const replay = payload?.replay === true;
    if (replay) replayedCount += 1;
    applied.push({ row: row.row, sku: row.sku, movementId: payload?.movement_id, replay });
  }

  return NextResponse.json({
    applied,
    errors,
    appliedCount: applied.length,
    replayedCount,
    errorCount: errors.length,
  });
}
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { inventoryImportSchema } from "@/lib/validation/schemas";
import { getAuthedContext } from "@/lib/auth/session";
import { canManageInventory } from "@/lib/domain/rbac";
import { parseInventoryCsv } from "@/lib/domain/inventory";

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = inventoryImportSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.orgId || !auth.role) {
    return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
  }

  const csv = parseInventoryCsv(parsed.data.csv);
  const supabase = await createClient();
  const role = auth.role;
  if (!role || !canManageInventory(role)) {
    return NextResponse.json({ error: "forbidden_inventory" }, { status: 403 });
  }

  const applied: Array<{ row: number; sku: string; movementId?: string }> = [];
  const errors = [...csv.errors];

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

    const { data, error } = await supabase.rpc("adjust_inventory", {
      p_payload: {
        store_id: parsed.data.store_id,
        product_id: product.id,
        delta: row.delta,
        reason: row.reason,
        movement_type: row.movementType,
      },
    });

    if (error) {
      errors.push({ row: row.row, sku: row.sku, message: "Ajuste de inventário rejeitado" });
      continue;
    }

    const payload = data as { movement_id?: string } | null;
    applied.push({ row: row.row, sku: row.sku, movementId: payload?.movement_id });
  }

  return NextResponse.json({
    applied,
    errors,
    appliedCount: applied.length,
    errorCount: errors.length,
  });
}
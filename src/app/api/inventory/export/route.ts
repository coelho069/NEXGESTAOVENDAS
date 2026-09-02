import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { inventoryListQuerySchema } from "@/lib/validation/schemas";
import { getAuthedContext } from "@/lib/auth/session";
import { resolveStoreRole } from "@/lib/auth/authorization";
import { canSeeCostPrice } from "@/lib/domain/rbac";
import { toExportCsv } from "@/lib/domain/inventory";

export async function GET(request: Request) {
  const auth = await getAuthedContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = inventoryListQuerySchema.safeParse({
    store_id: url.searchParams.get("store_id") ?? undefined,
    cursor_sku: url.searchParams.get("cursor_sku") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createClient();
  const role = await resolveStoreRole(supabase, {
    userId: auth.userId,
    orgId: auth.orgId,
    storeId: parsed.data.store_id,
  });
  if (!role) {
    return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
  }

  const { data, error } = await supabase.rpc("get_inventory_page", {
    p_payload: {
      store_id: parsed.data.store_id,
      cursor_sku: parsed.data.cursor_sku,
      limit: 100,
    },
  });

  if (error) {
    const status = error.message.includes("forbidden") ? 403 : 422;
    return NextResponse.json({ error: status === 403 ? "forbidden_store" : "inventory_unavailable" }, { status });
  }

  const payload = data as {
    rows?: Array<{
      sku: string;
      name: string;
      quantity: number;
      unit_price: string;
      cost_price: string | null;
    }>;
  };

  const csv = toExportCsv(
    (payload.rows ?? []).map((row) => ({
      sku: row.sku,
      name: row.name,
      quantity: row.quantity,
      unitPrice: row.unit_price,
      costPrice: canSeeCostPrice(role) ? row.cost_price : null,
    }))
  );

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=inventory.csv",
    },
  });
}
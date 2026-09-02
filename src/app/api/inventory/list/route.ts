import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { inventoryListQuerySchema } from "@/lib/validation/schemas";
import { getAuthedContext } from "@/lib/auth/session";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = inventoryListQuerySchema.safeParse({
    store_id: url.searchParams.get("store_id") ?? undefined,
    cursor_sku: url.searchParams.get("cursor_sku") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.role) {
    return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_inventory_page", {
    p_payload: {
      store_id: parsed.data.store_id,
      cursor_sku: parsed.data.cursor_sku,
      limit: parsed.data.limit,
    },
  });

  if (error) {
    const status = error.message.includes("forbidden") ? 403 : 422;
    return NextResponse.json({ error: status === 403 ? "forbidden_store" : "inventory_unavailable" }, { status });
  }

  return NextResponse.json(data);
}
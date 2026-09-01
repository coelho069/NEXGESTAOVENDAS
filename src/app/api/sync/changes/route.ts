import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { pullChangesQuerySchema } from "@/lib/validation/schemas";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = pullChangesQuerySchema.safeParse({
    store_id: url.searchParams.get("store_id"),
    since: url.searchParams.get("since") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { store_id, since } = parsed.data;

  let inventoryQuery = supabase
    .from("inventory_balances")
    .select("store_id, product_id, quantity, updated_at")
    .eq("store_id", store_id);

  let salesQuery = supabase
    .from("sales")
    .select("id, client_mutation_id, status, sync_status, total, updated_at")
    .eq("store_id", store_id)
    .order("updated_at", { ascending: true })
    .limit(200);

  if (since) {
    inventoryQuery = inventoryQuery.gt("updated_at", since);
    salesQuery = salesQuery.gt("updated_at", since);
  }

  const [inventory, sales] = await Promise.all([inventoryQuery, salesQuery]);

  if (inventory.error) {
    return NextResponse.json({ error: inventory.error.message }, { status: 422 });
  }
  if (sales.error) {
    return NextResponse.json({ error: sales.error.message }, { status: 422 });
  }

  return NextResponse.json({
    serverTime: new Date().toISOString(),
    inventory: inventory.data ?? [],
    sales: sales.data ?? [],
  });
}

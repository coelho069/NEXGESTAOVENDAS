import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { pullChangesQuerySchema, storeIdSchema } from "@/lib/validation/schemas";
import { getAuthedContext } from "@/lib/auth/session";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const storeIdResult = storeIdSchema.safeParse(url.searchParams.get("store_id"));
  if (!storeIdResult.success) {
    return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
  }

  const parsed = pullChangesQuerySchema.safeParse({
    store_id: storeIdResult.data,
    since: url.searchParams.get("since") ?? undefined,
    sales_after_updated_at: url.searchParams.get("sales_after_updated_at") ?? undefined,
    sales_after_id: url.searchParams.get("sales_after_id") ?? undefined,
    reconcile_id: url.searchParams.getAll("reconcile_id"),
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const {
    store_id,
    since,
    sales_after_updated_at: salesAfterUpdatedAt,
    sales_after_id: salesAfterId,
    reconcile_id: reconcileIds,
  } = parsed.data;
  const auth = await getAuthedContext(store_id);
  if (!auth?.role) {
    return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
  }

  const supabase = await createClient();
  let inventoryQuery = supabase
    .from("inventory_balances")
    .select("store_id, product_id, quantity, updated_at")
    .eq("store_id", store_id);

  let salesQuery = supabase
    .from("sales")
    .select("id, client_mutation_id, status, sync_status, total, updated_at")
    .eq("store_id", store_id)
    .order("updated_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(201);

  if (since) {
    inventoryQuery = inventoryQuery.gt("updated_at", since);
  }

  if (salesAfterUpdatedAt && salesAfterId) {
    salesQuery = salesQuery.or(
      `updated_at.gt.${salesAfterUpdatedAt},and(updated_at.eq.${salesAfterUpdatedAt},id.gt.${salesAfterId})`
    );
  } else if (since) {
    salesQuery = salesQuery.gt("updated_at", since);
  }

  const reconciliationQuery =
    reconcileIds.length > 0
      ? supabase
          .from("sales")
          .select("id, client_mutation_id, status, sync_status, total, updated_at")
          .eq("store_id", store_id)
          .in("client_mutation_id", reconcileIds)
      : null;

  const [inventory, sales, reconciliation] = await Promise.all([
    inventoryQuery,
    salesQuery,
    reconciliationQuery ?? Promise.resolve({ data: [], error: null }),
  ]);

  if (inventory.error) {
    return NextResponse.json({ error: "inventory_sync_failed" }, { status: 422 });
  }
  if (sales.error) {
    return NextResponse.json({ error: "sales_sync_failed" }, { status: 422 });
  }
  if (reconciliation.error) {
    return NextResponse.json({ error: "sales_reconciliation_failed" }, { status: 422 });
  }

  const pageSales = (sales.data ?? []).slice(0, 200);
  const hasMore = (sales.data ?? []).length > 200;
  const lastPageSale = pageSales.at(-1);
  const mergedSales = new Map(pageSales.map((sale) => [sale.id, sale]));
  for (const sale of reconciliation.data ?? []) {
    mergedSales.set(sale.id, sale);
  }

  return NextResponse.json({
    serverTime: new Date().toISOString(),
    has_more: hasMore,
    next_cursor:
      hasMore && lastPageSale
        ? {
            since: since ?? null,
            sales_after_updated_at: lastPageSale.updated_at,
            sales_after_id: lastPageSale.id,
          }
        : null,
    inventory: inventory.data ?? [],
    sales: [...mergedSales.values()],
  });
}

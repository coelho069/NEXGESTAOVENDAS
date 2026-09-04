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
    inventory_after_updated_at:
      url.searchParams.get("inventory_after_updated_at") ?? undefined,
    inventory_after_product_id:
      url.searchParams.get("inventory_after_product_id") ?? undefined,
    inventory_after_created_at:
      url.searchParams.get("inventory_after_created_at") ?? undefined,
    inventory_after_id: url.searchParams.get("inventory_after_id") ?? undefined,
    reconcile_id: url.searchParams.getAll("reconcile_id"),
    reconcile_inventory_id: url.searchParams.getAll("reconcile_inventory_id"),
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
    inventory_after_updated_at: inventoryAfterUpdatedAt,
    inventory_after_product_id: inventoryAfterProductId,
    inventory_after_created_at: inventoryAfterCreatedAt,
    inventory_after_id: inventoryAfterId,
    reconcile_id: reconcileIds,
    reconcile_inventory_id: reconcileInventoryIds,
  } = parsed.data;
  const auth = await getAuthedContext(store_id);
  if (!auth?.role) {
    return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
  }

  const supabase = await createClient();
  const snapshot = new Date().toISOString();
  let inventoryQuery = supabase
    .from("inventory_balances")
    .select("store_id, product_id, quantity, updated_at")
    .eq("store_id", store_id)
    .lte("updated_at", snapshot)
    .order("updated_at", { ascending: true })
    .order("product_id", { ascending: true })
    .limit(201);

  let inventoryMovementsQuery = supabase
    .from("inventory_movements")
    .select(
      "id, store_id, product_id, client_mutation_id, terminal_id, import_id, import_row, movement_type, quantity_change, balance_after, created_at"
    )
    .eq("store_id", store_id)
    .lte("created_at", snapshot)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(201);

  let salesQuery = supabase
    .from("sales")
    .select("id, client_mutation_id, status, sync_status, total, updated_at")
    .eq("store_id", store_id)
    .order("updated_at", { ascending: true })
    .order("id", { ascending: true })
    .lte("updated_at", snapshot)
    .limit(201);

  if (inventoryAfterUpdatedAt && inventoryAfterProductId) {
    inventoryQuery = inventoryQuery.or(
      `updated_at.gt.${inventoryAfterUpdatedAt},and(updated_at.eq.${inventoryAfterUpdatedAt},product_id.gt.${inventoryAfterProductId})`
    );
  } else if (since) {
    inventoryQuery = inventoryQuery.gt("updated_at", since);
  }

  if (inventoryAfterCreatedAt && inventoryAfterId) {
    inventoryMovementsQuery = inventoryMovementsQuery.or(
      `created_at.gt.${inventoryAfterCreatedAt},and(created_at.eq.${inventoryAfterCreatedAt},id.gt.${inventoryAfterId})`
    );
  } else if (since) {
    inventoryMovementsQuery = inventoryMovementsQuery.gt("created_at", since);
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
  const inventoryReconciliationQuery =
    reconcileInventoryIds.length > 0
      ? supabase
          .from("inventory_movements")
          .select(
            "id, store_id, product_id, client_mutation_id, terminal_id, import_id, import_row, movement_type, quantity_change, balance_after, created_at"
          )
          .eq("store_id", store_id)
          .in("client_mutation_id", reconcileInventoryIds)
          .lte("created_at", snapshot)
      : null;

  const [inventory, inventoryMovements, sales, reconciliation, inventoryReconciliation] =
    await Promise.all([
    inventoryQuery,
    inventoryMovementsQuery,
    salesQuery,
    reconciliationQuery ?? Promise.resolve({ data: [], error: null }),
    inventoryReconciliationQuery ?? Promise.resolve({ data: [], error: null }),
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
  if (inventoryMovements.error) {
    return NextResponse.json({ error: "inventory_movement_sync_failed" }, { status: 422 });
  }
  if (inventoryReconciliation.error) {
    return NextResponse.json(
      { error: "inventory_reconciliation_failed" },
      { status: 422 }
    );
  }

  const pageInventory = (inventory.data ?? []).slice(0, 200);
  const pageInventoryMovements = (inventoryMovements.data ?? []).slice(0, 200);
  const pageSales = (sales.data ?? []).slice(0, 200);
  const hasMore =
    (inventory.data ?? []).length > 200 ||
    (inventoryMovements.data ?? []).length > 200 ||
    (sales.data ?? []).length > 200;
  const lastInventory = pageInventory.at(-1);
  const lastInventoryMovement = pageInventoryMovements.at(-1);
  const lastPageSale = pageSales.at(-1);
  const mergedSales = new Map(pageSales.map((sale) => [sale.id, sale]));
  for (const sale of reconciliation.data ?? []) {
    mergedSales.set(sale.id, sale);
  }
  const mergedInventoryMovements = new Map(
    pageInventoryMovements.map((movement) => [movement.id, movement])
  );
  for (const movement of inventoryReconciliation.data ?? []) {
    mergedInventoryMovements.set(movement.id, movement);
  }

  return NextResponse.json({
    serverTime: snapshot,
    has_more: hasMore,
    next_cursor: {
      since: snapshot,
      ...(lastInventory
        ? {
            inventory_after_updated_at: lastInventory.updated_at,
            inventory_after_product_id: lastInventory.product_id,
          }
        : inventoryAfterUpdatedAt && inventoryAfterProductId
          ? {
              inventory_after_updated_at: inventoryAfterUpdatedAt,
              inventory_after_product_id: inventoryAfterProductId,
            }
          : {}),
      ...(lastInventoryMovement
        ? {
            inventory_after_created_at: lastInventoryMovement.created_at,
            inventory_after_id: lastInventoryMovement.id,
          }
        : inventoryAfterCreatedAt && inventoryAfterId
          ? {
              inventory_after_created_at: inventoryAfterCreatedAt,
              inventory_after_id: inventoryAfterId,
            }
          : {}),
      ...(lastPageSale
        ? {
            sales_after_updated_at: lastPageSale.updated_at,
            sales_after_id: lastPageSale.id,
          }
        : salesAfterUpdatedAt && salesAfterId
          ? {
              sales_after_updated_at: salesAfterUpdatedAt,
              sales_after_id: salesAfterId,
            }
          : {}),
    },
    inventory: pageInventory,
    inventory_movements: [...mergedInventoryMovements.values()],
    sales: [...mergedSales.values()],
  });
}

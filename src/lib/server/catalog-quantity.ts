import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { catalogQuantityDelta } from "@/lib/domain/catalog-quantity";
import { toInventoryQuantity } from "@/lib/domain/quantity";
import type { Database } from "@/lib/db/types";

type CatalogSupabase = SupabaseClient<Database>;

export async function applyCatalogQuantity(
  supabase: CatalogSupabase,
  input: {
    storeId: string;
    productId: string;
    quantity: string;
    reason: string;
    currentQuantity?: string;
  }
): Promise<{ quantity: string } | { error: "product_quantity_failed" }> {
  const target = toInventoryQuantity(input.quantity);
  let current = input.currentQuantity;
  if (current === undefined) {
    const { data: balance, error: balanceError } = await supabase
      .from("inventory_balances")
      .select("quantity")
      .eq("store_id", input.storeId)
      .eq("product_id", input.productId)
      .maybeSingle();
    if (balanceError) return { error: "product_quantity_failed" };
    current = balance?.quantity == null ? "0" : String(balance.quantity);
  }
  current = toInventoryQuantity(current);
  const change = catalogQuantityDelta(current, target);
  if (!change) return { quantity: current };

  const { error } = await supabase.rpc("adjust_inventory", {
    p_payload: {
      store_id: input.storeId,
      product_id: input.productId,
      client_mutation_id: randomUUID(),
      delta: change.delta,
      reason: input.reason,
      movement_type: change.movementType,
    },
  });
  if (error) return { error: "product_quantity_failed" };
  return { quantity: target };
}

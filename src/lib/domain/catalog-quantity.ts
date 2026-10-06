import Decimal from "decimal.js";
import { toInventoryDelta, toInventoryQuantity } from "@/lib/domain/quantity";

export function catalogQuantityDelta(
  current: string,
  target: string
): { delta: string; movementType: "restock" | "adjustment" } | null {
  const difference = new Decimal(toInventoryQuantity(target)).minus(toInventoryQuantity(current));
  if (difference.isZero()) return null;
  return {
    delta: toInventoryDelta(difference.toFixed(3)),
    movementType: difference.isPositive() ? "restock" : "adjustment",
  };
}

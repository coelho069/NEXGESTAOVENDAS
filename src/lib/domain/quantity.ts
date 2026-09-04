import Decimal from "decimal.js";

export const INVENTORY_QUANTITY_MAX = "999999999.999";
export const INVENTORY_QUANTITY_SCALE = 3;

export type QuantityInput = string | number;

function toDecimal(value: QuantityInput): Decimal {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("quantity must be finite");
  }
  const decimal = new Decimal(value);
  if (!decimal.isFinite() || decimal.isNaN()) {
    throw new Error("quantity must be finite");
  }
  return decimal;
}

export function toInventoryQuantity(value: QuantityInput): string {
  const decimal = toDecimal(value);
  if (
    decimal.isNegative() ||
    decimal.gt(INVENTORY_QUANTITY_MAX) ||
    decimal.decimalPlaces() > INVENTORY_QUANTITY_SCALE
  ) {
    throw new Error("quantity must be non-negative numeric(12,3)");
  }
  return decimal.toFixed(INVENTORY_QUANTITY_SCALE);
}

export function toInventoryDelta(value: QuantityInput): string {
  const decimal = toDecimal(value);
  if (
    decimal.isZero() ||
    decimal.abs().gt(INVENTORY_QUANTITY_MAX) ||
    decimal.decimalPlaces() > INVENTORY_QUANTITY_SCALE
  ) {
    throw new Error("delta must be a non-zero numeric(12,3)");
  }
  return decimal.toFixed(INVENTORY_QUANTITY_SCALE);
}

export function toInventoryDifference(value: QuantityInput): string {
  const decimal = toDecimal(value);
  if (
    decimal.abs().gt(INVENTORY_QUANTITY_MAX) ||
    decimal.decimalPlaces() > INVENTORY_QUANTITY_SCALE
  ) {
    throw new Error("quantity difference must fit numeric(12,3)");
  }
  return decimal.toFixed(INVENTORY_QUANTITY_SCALE);
}

export function normalizeLegacyInventoryQuantity(value: QuantityInput): string {
  const decimal = toDecimal(value).toDecimalPlaces(INVENTORY_QUANTITY_SCALE, Decimal.ROUND_HALF_UP);
  if (decimal.isNegative() || decimal.gt(INVENTORY_QUANTITY_MAX)) {
    throw new Error("legacy quantity is outside numeric(12,3)");
  }
  return decimal.toFixed(INVENTORY_QUANTITY_SCALE);
}

export function addInventoryQuantities(
  left: QuantityInput,
  right: QuantityInput
): string {
  const result = toDecimal(left).plus(toDecimal(right));
  return toInventoryQuantity(result.toFixed(INVENTORY_QUANTITY_SCALE));
}

export function subtractInventoryQuantities(
  left: QuantityInput,
  right: QuantityInput
): string {
  const result = toDecimal(left).minus(toDecimal(right));
  return toInventoryQuantity(result.toFixed(INVENTORY_QUANTITY_SCALE));
}

export function addInventoryDifferences(
  left: QuantityInput,
  right: QuantityInput
): string {
  return toInventoryDifference(toDecimal(left).plus(toDecimal(right)).toFixed(3));
}

export function subtractInventoryDifferences(
  left: QuantityInput,
  right: QuantityInput
): string {
  return toInventoryDifference(toDecimal(left).minus(toDecimal(right)).toFixed(3));
}

export function compareInventoryQuantities(
  left: QuantityInput,
  right: QuantityInput
): number {
  return toDecimal(left).cmp(toDecimal(right));
}

export function inventoryQuantityToNumber(value: QuantityInput): number {
  return Number(toInventoryQuantity(value));
}

export function isPositiveInventoryDelta(value: QuantityInput): boolean {
  return toDecimal(value).isPositive();
}

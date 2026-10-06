import { describe, expect, it } from "vitest";
import { catalogQuantityDelta } from "@/lib/domain/catalog-quantity";

describe("catalog quantity", () => {
  it("restocks when the new quantity is higher", () => {
    expect(catalogQuantityDelta("2", "5")).toEqual({
      delta: "3.000",
      movementType: "restock",
    });
  });

  it("adjusts down when the new quantity is lower", () => {
    expect(catalogQuantityDelta("5.000", "1.5")).toEqual({
      delta: "-3.500",
      movementType: "adjustment",
    });
  });

  it("skips a movement when the quantity does not change", () => {
    expect(catalogQuantityDelta("4", "4.000")).toBeNull();
  });
});

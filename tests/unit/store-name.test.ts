import { describe, expect, it } from "vitest";
import { isValidStoreName, normalizeStoreName, STORE_NAME_MAX_LENGTH } from "@/lib/domain/store-name";

describe("store name", () => {
  it("collapses inner spaces and trims the edges", () => {
    expect(normalizeStoreName("  Loja   do  Centro ")).toBe("Loja do Centro");
  });

  it("accepts 2 to 80 characters after normalization", () => {
    expect(isValidStoreName("Ab")).toBe(true);
    expect(isValidStoreName("a".repeat(STORE_NAME_MAX_LENGTH))).toBe(true);
    expect(isValidStoreName("   ")).toBe(false);
    expect(isValidStoreName("A")).toBe(false);
    expect(isValidStoreName("a".repeat(STORE_NAME_MAX_LENGTH + 1))).toBe(false);
  });
});

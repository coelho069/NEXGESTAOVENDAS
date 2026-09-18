import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260918010000_assert_sale_discount_cap_zero_discount.sql"
  ),
  "utf8"
);

describe("assert_sale_discount_cap zero-discount migration", () => {
  it("returns before auth/store checks when discount is zero or null", () => {
    const zeroReturn = MIGRATION.indexOf("IF p_discount IS NULL OR p_discount <= 0 THEN");
    const authCheck = MIGRATION.indexOf("IF (SELECT auth.uid()) IS NULL");
    expect(zeroReturn).toBeGreaterThan(-1);
    expect(authCheck).toBeGreaterThan(-1);
    expect(zeroReturn).toBeLessThan(authCheck);
  });

  it("keeps role-based caps when discount is positive", () => {
    expect(MIGRATION).toContain("WHEN 'cashier' THEN 5");
    expect(MIGRATION).toContain("discount_limit_exceeded");
    expect(MIGRATION).toContain("forbidden_store");
  });
});

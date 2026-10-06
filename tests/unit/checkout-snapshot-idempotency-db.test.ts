import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("local checkout snapshot and refund claim", () => {
  it("persists the snapshot and a single claim, then rolls the migration back", () => {
    const output = execFileSync("bash", ["scripts/verify-refund-snapshot-local.sh"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(output).toContain("local snapshot and claim verified");
  }, 60_000);
});

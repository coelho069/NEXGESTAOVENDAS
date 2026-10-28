import { describe, expect, it } from "vitest";
import { ageOnDate, isAdultOnDate, isIsoDate } from "@/lib/domain/age-gate";

describe("ageOnDate", () => {
  it("does not count the birthday before it happens in the year", () => {
    expect(ageOnDate("2008-10-27", "2026-10-26")).toBe(17);
  });

  it("counts the birthday on the day itself", () => {
    expect(ageOnDate("2008-10-26", "2026-10-26")).toBe(18);
  });
});

describe("isAdultOnDate", () => {
  it("accepts exactly 18 years old", () => {
    expect(isAdultOnDate("2008-10-26", "2026-10-26")).toBe(true);
  });

  it("rejects one day short of 18", () => {
    expect(isAdultOnDate("2008-10-27", "2026-10-26")).toBe(false);
  });

  it("rejects a future birth date", () => {
    expect(isAdultOnDate("2026-10-27", "2026-10-26")).toBe(false);
  });

  it("rejects malformed dates", () => {
    expect(isAdultOnDate("26/10/1990", "2026-10-26")).toBe(false);
    expect(isAdultOnDate("1990-02-30", "2026-10-26")).toBe(false);
  });
});

describe("isIsoDate", () => {
  it("accepts YYYY-MM-DD only", () => {
    expect(isIsoDate("1990-05-01")).toBe(true);
    expect(isIsoDate("")).toBe(false);
  });
});

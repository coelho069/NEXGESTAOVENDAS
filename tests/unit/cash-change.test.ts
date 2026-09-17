import { describe, expect, it } from "vitest";
import { resolveCashChange } from "@/lib/domain/cash-change";

describe("resolveCashChange", () => {
  it("accepts received equal to total with zero change", () => {
    expect(resolveCashChange("10.00", "10")).toEqual({
      ok: true,
      received: "10.00",
      change: "0.00",
    });
  });

  it("computes change when received is greater than total", () => {
    expect(resolveCashChange("3.50", "10")).toEqual({
      ok: true,
      received: "10.00",
      change: "6.50",
    });
  });

  it("rejects received below total", () => {
    expect(resolveCashChange("10.00", "9.99")).toEqual({
      ok: false,
      error: "Valor recebido deve ser maior ou igual ao total.",
    });
  });

  it("rejects invalid received input", () => {
    expect(resolveCashChange("10.00", "")).toEqual({
      ok: false,
      error: "Informe um valor recebido válido.",
    });
  });
});

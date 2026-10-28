import { describe, expect, it } from "vitest";
import {
  cashErrorMessage,
  cashMovementTypeLabel,
  normalizeCashMoneyInput,
} from "@/lib/domain/cash-errors";

describe("cash-errors", () => {
  it("maps API codes to pt-BR", () => {
    expect(cashErrorMessage("forbidden_cash")).toMatch(/permissão/i);
    expect(cashErrorMessage("cash_session_conflict")).toMatch(/conflito|aberto/i);
  });

  it("keeps human messages", () => {
    expect(cashErrorMessage("Abra o caixa antes")).toBe("Abra o caixa antes");
  });

  it("labels movement types", () => {
    expect(cashMovementTypeLabel("withdrawal")).toBe("Sangria");
    expect(cashMovementTypeLabel("supply")).toBe("Suprimento");
    expect(cashMovementTypeLabel("sale_cash")).toMatch(/Venda/);
  });

  it("normalizes BR money input", () => {
    expect(normalizeCashMoneyInput("100,50")).toBe("100.50");
    expect(normalizeCashMoneyInput("10")).toBe("10.00");
    expect(normalizeCashMoneyInput("")).toBeNull();
    expect(normalizeCashMoneyInput("-1")).toBeNull();
  });
});

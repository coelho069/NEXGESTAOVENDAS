import { describe, expect, it } from "vitest";
import { accountBalanceNotice } from "@/lib/domain/account-balance-notice";

describe("account balance notice", () => {
  it("stays quiet when nothing approved is waiting", () => {
    expect(
      accountBalanceNotice({
        approvedUnsentCount: 0,
        outstanding: { reliableTotal: "0.00", reliableCount: 0, unavailableCount: 0 },
      })
    ).toBeNull();
  });

  it("names the single approved amount that was not sent", () => {
    const notice = accountBalanceNotice({
      approvedUnsentCount: 1,
      outstanding: { reliableTotal: "5.00", reliableCount: 1, unavailableCount: 0 },
    });
    expect(notice).toContain("Aviso de saldo da conta Mercado Pago");
    expect(notice).toContain("5,00");
    expect(notice).toContain("saldo disponível");
  });

  it("sums several approved amounts", () => {
    const notice = accountBalanceNotice({
      approvedUnsentCount: 2,
      outstanding: { reliableTotal: "15.50", reliableCount: 2, unavailableCount: 0 },
    });
    expect(notice).toContain("estornos aprovados");
    expect(notice).toContain("15,50");
  });
});

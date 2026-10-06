import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { accountBalanceNotice } from "@/lib/domain/account-balance-notice";
import { summarizeTrustedPaymentSnapshots } from "@/lib/domain/refund-outstanding";

describe("trusted refund outstanding", () => {
  it("shows the snapshot amount", () => {
    const outstanding = summarizeTrustedPaymentSnapshots(["910583210401"], [
      { mp_payment_id: "910583210401", transaction_amount: "123.45", transaction_currency: "BRL" },
    ]);
    expect(outstanding).toEqual({ reliableTotal: "123.45", reliableCount: 1, unavailableCount: 0 });
    expect(accountBalanceNotice({ approvedUnsentCount: 1, outstanding })).toContain("123,45");
  });

  it("keeps the snapshot when the current plan price is different", () => {
    const outstanding = summarizeTrustedPaymentSnapshots(["910583210401"], [
      {
        mp_payment_id: "910583210401",
        transaction_amount: "123.45",
        transaction_currency: "BRL",
        plan_amount: "999.00",
      },
    ]);
    const notice = accountBalanceNotice({ approvedUnsentCount: 1, outstanding });
    expect(notice).toContain("123,45");
    expect(notice).not.toContain("999");
  });

  it("does not invent an amount when the snapshot is missing", () => {
    const outstanding = summarizeTrustedPaymentSnapshots(["910583210401"], [
      { mp_payment_id: "910583210401", transaction_amount: null, transaction_currency: null },
    ]);
    expect(outstanding.reliableCount).toBe(0);
    expect(outstanding.unavailableCount).toBe(1);
    const notice = accountBalanceNotice({ approvedUnsentCount: 1, outstanding });
    expect(notice).toContain("indisponível");
    expect(notice).not.toContain("R$");
  });

  it("sums only payments that have a trustworthy snapshot", () => {
    const outstanding = summarizeTrustedPaymentSnapshots(["111111", "222222", "333333"], [
      { mp_payment_id: "111111", transaction_amount: "10.00", transaction_currency: "BRL" },
      { mp_payment_id: "222222", transaction_amount: "2.50", transaction_currency: "BRL" },
      { mp_payment_id: "333333", transaction_amount: null, transaction_currency: "BRL" },
    ]);
    expect(outstanding).toEqual({ reliableTotal: "12.50", reliableCount: 2, unavailableCount: 1 });
    const notice = accountBalanceNotice({ approvedUnsentCount: 3, outstanding });
    expect(notice).toContain("12,50");
    expect(notice).toContain("1 pagamento(s) seguem com valor indisponível");
  });

  it("does not read plans.amount for the admin balance", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/server/admin-refund-requests-query.ts"), "utf8");
    const start = source.indexOf("export async function loadApprovedUnsentOutstanding");
    const body = source.slice(start, source.indexOf("export type RefundSandboxPresentation"));
    expect(body).not.toContain("plans");
    expect(body).toContain("transaction_amount");
  });
});

describe("account balance notice", () => {
  it("stays quiet when nothing approved is waiting", () => {
    expect(
      accountBalanceNotice({
        approvedUnsentCount: 0,
        outstanding: { reliableTotal: "0.00", reliableCount: 0, unavailableCount: 0 },
      })
    ).toBeNull();
  });
});

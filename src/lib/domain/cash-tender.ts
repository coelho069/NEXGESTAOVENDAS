import { money, toMoneyString } from "@/lib/money";

const MONEY_PATTERN = /^(?:0|[1-9]\d{0,9})\.\d{2}$/;

export type CashTenderResult =
  | { ok: true; amountReceived: string; changeDue: string }
  | { ok: false; error: string };

export function isValidMoneyInput(value: string): boolean {
  return MONEY_PATTERN.test(value);
}

/**
 * Cash drawer ledger still records only the sale total.
 * Tendered amount and change are operator UX + receipt metadata.
 */
export function resolveCashTender(total: string, amountReceived: string): CashTenderResult {
  if (!isValidMoneyInput(total)) {
    return { ok: false, error: "Total da venda inválido" };
  }
  if (!isValidMoneyInput(amountReceived)) {
    return { ok: false, error: "Valor recebido inválido" };
  }

  const totalAmount = money(total);
  const received = money(amountReceived);
  if (received.lt(totalAmount)) {
    return { ok: false, error: "Valor recebido insuficiente" };
  }

  return {
    ok: true,
    amountReceived: toMoneyString(received),
    changeDue: toMoneyString(received.minus(totalAmount)),
  };
}

export function suggestCashTenders(total: string): string[] {
  if (!isValidMoneyInput(total)) return [];
  const totalAmount = money(total);
  const suggestions = new Set<string>([toMoneyString(totalAmount)]);
  for (const step of [10, 20, 50, 100]) {
    const rounded = totalAmount.div(step).ceil().times(step);
    if (rounded.gte(totalAmount)) {
      suggestions.add(toMoneyString(rounded));
    }
  }
  return [...suggestions].sort((a, b) => money(a).comparedTo(money(b)));
}

import { money, subtractMoney, toMoneyString } from "@/lib/money";
import { parseMoneyInput } from "@/lib/domain/sale-ops";

export type CashChangeResult =
  | { ok: true; received: string; change: string }
  | { ok: false; error: string };

/** UX helper only — does not alter charged sale total. */
export function resolveCashChange(total: string, receivedRaw: string): CashChangeResult {
  const received = parseMoneyInput(receivedRaw);
  if (received == null) {
    return { ok: false, error: "Informe um valor recebido válido." };
  }
  if (money(received).lt(money(total))) {
    return { ok: false, error: "Valor recebido deve ser maior ou igual ao total." };
  }
  return {
    ok: true,
    received: toMoneyString(money(received)),
    change: subtractMoney(received, total),
  };
}

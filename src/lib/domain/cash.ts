import Decimal from "decimal.js";
import type { Enums } from "@/lib/db/types";
import { money, toMoneyString } from "@/lib/money";

export type CashSessionStatus = Enums<"cash_session_status">;
export type CashMovementType = Enums<"cash_movement_type">;
export type OperatorCashMovementType = Exclude<CashMovementType, "sale_cash">;

export type CashMovementView = {
  cash_movement_id: string;
  cash_session_id: string;
  store_id: string;
  terminal_id: string;
  movement_type: CashMovementType;
  amount: string;
  reason: string;
  created_by: string;
  client_mutation_id: string;
  sale_id: string | null;
  payment_id: string | null;
  created_at: string;
};

export type CashSessionView = {
  cash_session_id: string;
  org_id: string;
  store_id: string;
  terminal_id: string;
  status: CashSessionStatus;
  opening_amount: string;
  expected_amount: string;
  counted_amount: string | null;
  difference: string | null;
  opened_by: string;
  opened_at: string;
  closed_by: string | null;
  closed_at: string | null;
};

export type CashSessionResponse = {
  session: CashSessionView | null;
  movements: CashMovementView[];
  expected_amount: string;
};

export function calculateExpectedCash(
  openingAmount: string,
  movements: Array<Pick<CashMovementView, "amount">>
): string {
  return toMoneyString(
    movements.reduce((total, movement) => total.plus(money(movement.amount)), money(openingAmount))
  );
}

export function calculateCashDifference(countedAmount: string, expectedAmount: string): string {
  return toMoneyString(money(countedAmount).minus(money(expectedAmount)));
}

export function canTransitionCashSession(
  from: CashSessionStatus,
  to: CashSessionStatus
): boolean {
  return from === "open" && to === "closed";
}

/**
 * One open session is allowed per (store, terminal). Centro can have several
 * open rows across terminals. Selling must use the pair that matches this
 * terminal — a foreign open session is a conflict, not a valid caixa.
 */
export type OpenCashSaleContext =
  | { ok: true; cashSessionId: string; terminalId: string }
  | { ok: false; error: "cash_session_required" | "cash_session_conflict" };

export function resolveOpenCashSaleContext(input: {
  session: Pick<CashSessionView, "cash_session_id" | "terminal_id" | "status"> | null | undefined;
  terminalId: string;
}): OpenCashSaleContext {
  const terminalId = input.terminalId.trim();
  const session = input.session;
  if (!terminalId || !session) {
    return { ok: false, error: "cash_session_required" };
  }
  if (session.status !== "open" || !session.cash_session_id) {
    return { ok: false, error: "cash_session_required" };
  }
  if (session.terminal_id !== terminalId) {
    return { ok: false, error: "cash_session_conflict" };
  }
  return { ok: true, cashSessionId: session.cash_session_id, terminalId };
}

export function isNonNegativeMoney(value: string): boolean {
  const amount = new Decimal(value);
  return amount.isFinite() && amount.greaterThanOrEqualTo(0) && amount.decimalPlaces() <= 2;
}

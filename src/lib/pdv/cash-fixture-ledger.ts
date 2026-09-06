import { v4 as uuidv4 } from "uuid";
import {
  calculateExpectedCash,
  type CashMovementView,
  type CashSessionResponse,
} from "@/lib/domain/cash";
import { pdvFixturesEnabled } from "@/lib/pdv/fixtures";

const CACHE_KEY_PREFIX = "nex-cash-session:";
const FIXTURE_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

export function fixtureCashCacheKey(userId: string | null, storeId: string): string {
  return `${CACHE_KEY_PREFIX}${userId ?? "anonymous"}:${storeId}`;
}

export function readFixtureCashCache(
  userId: string | null,
  storeId: string
): CashSessionResponse | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(fixtureCashCacheKey(userId, storeId)) ?? "null");
    if (!value || typeof value !== "object") return null;
    const response = value as Partial<CashSessionResponse>;
    if (!Array.isArray(response.movements) || typeof response.expected_amount !== "string") {
      return null;
    }
    return response as CashSessionResponse;
  } catch {
    return null;
  }
}

export function writeFixtureCashCache(
  userId: string | null,
  storeId: string,
  response: CashSessionResponse
): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(fixtureCashCacheKey(userId, storeId), JSON.stringify(response));
}

function appendLedgerMovement(
  userId: string | null,
  storeId: string,
  movement: CashMovementView
): CashSessionResponse | null {
  if (!pdvFixturesEnabled()) return null;
  const current = readFixtureCashCache(userId, storeId);
  const session = current?.session;
  if (!current || !session || session.status !== "open") return null;
  if (session.terminal_id !== movement.terminal_id) return null;

  const movements = [...current.movements, movement];
  const expectedAmount = calculateExpectedCash(session.opening_amount, movements);
  const next: CashSessionResponse = {
    ...current,
    movements,
    expected_amount: expectedAmount,
    session: { ...session, expected_amount: expectedAmount },
  };
  writeFixtureCashCache(userId, storeId, next);
  return next;
}

export function appendFixtureSaleCash(input: {
  userId: string | null;
  storeId: string;
  terminalId: string;
  cashSessionId: string;
  saleId: string;
  amount: string;
  clientMutationId: string;
}): CashSessionResponse | null {
  return appendLedgerMovement(input.userId, input.storeId, {
    cash_movement_id: uuidv4(),
    cash_session_id: input.cashSessionId,
    store_id: input.storeId,
    terminal_id: input.terminalId,
    movement_type: "sale_cash",
    amount: input.amount,
    reason: `Venda ${input.saleId}`,
    created_by: FIXTURE_USER_ID,
    client_mutation_id: input.clientMutationId,
    sale_id: input.saleId,
    payment_id: null,
    created_at: new Date().toISOString(),
  });
}

export function appendFixtureRefundCash(input: {
  userId: string | null;
  storeId: string;
  terminalId: string;
  cashSessionId: string;
  saleId: string;
  returnId: string;
  amount: string;
  clientMutationId: string;
}): CashSessionResponse | null {
  const refund = input.amount.startsWith("-") ? input.amount : `-${input.amount}`;
  return appendLedgerMovement(input.userId, input.storeId, {
    cash_movement_id: uuidv4(),
    cash_session_id: input.cashSessionId,
    store_id: input.storeId,
    terminal_id: input.terminalId,
    movement_type: "refund_cash",
    amount: refund,
    reason: `Devolução venda ${input.saleId}`,
    created_by: FIXTURE_USER_ID,
    client_mutation_id: input.clientMutationId,
    sale_id: input.saleId,
    payment_id: null,
    created_at: new Date().toISOString(),
  });
}

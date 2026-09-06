"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  calculateCashDifference,
  calculateExpectedCash,
  type CashMovementView,
  type CashSessionResponse,
} from "@/lib/domain/cash";
import { pdvFixturesEnabled } from "@/lib/pdv/fixtures";
import {
  readFixtureCashCache,
  writeFixtureCashCache,
} from "@/lib/pdv/cash-fixture-ledger";
import { getTerminalId } from "@/lib/offline/terminal-identity";
import { useSessionStore } from "@/stores/session-store";

const FIXTURE_ORG_ID = "11111111-1111-4111-8111-111111111111";
const FIXTURE_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type CashActionError = {
  error?: string;
};

class CashActionRejected extends Error {}

function pendingMutationStorageKey(userId: string | null, storeId: string): string {
  return `nex-cash-pending-mutations:${userId ?? "anonymous"}:${storeId}`;
}

function readPendingMutations(userId: string | null, storeId: string): Record<string, string> {
  if (typeof sessionStorage === "undefined") return {};
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(pendingMutationStorageKey(userId, storeId)) ?? "{}");
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([key, mutationId]) => key.length > 0 && typeof mutationId === "string" && mutationId.length > 0
      )
    );
  } catch {
    return {};
  }
}

function writePendingMutations(userId: string | null, storeId: string, mutations: Record<string, string>): void {
  if (typeof sessionStorage === "undefined") return;
  if (Object.keys(mutations).length === 0) {
    sessionStorage.removeItem(pendingMutationStorageKey(userId, storeId));
    return;
  }
  sessionStorage.setItem(pendingMutationStorageKey(userId, storeId), JSON.stringify(mutations));
}

function readCached(userId: string | null, storeId: string): CashSessionResponse | null {
  return readFixtureCashCache(userId, storeId);
}

function writeCached(userId: string | null, storeId: string, response: CashSessionResponse): void {
  writeFixtureCashCache(userId, storeId, response);
}

function fixtureResponse(storeId: string, terminalId: string): CashSessionResponse {
  return {
    session: {
      cash_session_id: "66666666-6666-4666-8666-666666666666",
      org_id: FIXTURE_ORG_ID,
      store_id: storeId,
      terminal_id: terminalId,
      status: "open",
      opening_amount: "0.00",
      expected_amount: "0.00",
      counted_amount: null,
      difference: null,
      opened_by: FIXTURE_USER_ID,
      opened_at: new Date().toISOString(),
      closed_by: null,
      closed_at: null,
    },
    movements: [],
    expected_amount: "0.00",
  };
}

function fixtureMovement(
  storeId: string,
  terminalId: string,
  sessionId: string,
  type: "supply" | "withdrawal" | "adjustment",
  amount: string,
  reason: string
): CashMovementView {
  const signedAmount = type === "withdrawal" ? `-${amount}` : amount;
  return {
    cash_movement_id: uuidv4(),
    cash_session_id: sessionId,
    store_id: storeId,
    terminal_id: terminalId,
    movement_type: type,
    amount: signedAmount,
    reason,
    created_by: FIXTURE_USER_ID,
    client_mutation_id: uuidv4(),
    sale_id: null,
    payment_id: null,
    created_at: new Date().toISOString(),
  };
}

export function useCashSession(storeId: string | null) {
  const fixtures = pdvFixturesEnabled();
  const userId = useSessionStore((state) => state.userId);
  const pendingMutations = useRef<Record<string, string>>({});
  const pendingScope = useRef<string | null>(null);
  const [terminalId, setTerminalId] = useState("");
  const [response, setResponse] = useState<CashSessionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTerminalId(getTerminalId());
  }, []);

  const saveResponse = useCallback((next: CashSessionResponse) => {
    setResponse(next);
    if (storeId) writeCached(userId, storeId, next);
  }, [storeId, userId]);

  const getPendingMutation = useCallback(
    (operationKey: string): string => {
      if (!storeId) throw new Error("Loja ainda não selecionada");
      const scope = `${userId ?? "anonymous"}:${storeId}`;
      if (pendingScope.current !== scope) {
        pendingScope.current = scope;
        pendingMutations.current = readPendingMutations(userId, storeId);
      }
      const mutationId = pendingMutations.current[operationKey] ?? uuidv4();
      pendingMutations.current[operationKey] = mutationId;
      writePendingMutations(userId, storeId, pendingMutations.current);
      return mutationId;
    },
    [storeId, userId]
  );

  const clearPendingMutation = useCallback(
    (operationKey: string) => {
      if (!storeId) return;
      const scope = `${userId ?? "anonymous"}:${storeId}`;
      if (pendingScope.current !== scope) {
        pendingScope.current = scope;
        pendingMutations.current = readPendingMutations(userId, storeId);
      }
      delete pendingMutations.current[operationKey];
      writePendingMutations(userId, storeId, pendingMutations.current);
    },
    [storeId, userId]
  );

  const refresh = useCallback(async () => {
    if (!storeId || !terminalId) {
      setResponse(null);
      return;
    }

    setLoading(true);
    setError(null);
    if (fixtures) {
      const cached = readCached(userId, storeId);
      saveResponse(cached?.session?.terminal_id === terminalId ? cached : fixtureResponse(storeId, terminalId));
      setOffline(false);
      setLoading(false);
      return;
    }

    try {
      const query = new URLSearchParams({
        store_id: storeId,
        terminal_id: terminalId,
      });
      const result = await fetch(`/api/cash/session?${query.toString()}`, { cache: "no-store" });
      const body: unknown = await result.json().catch(() => null);
      if (!result.ok) {
        const message =
          body && typeof body === "object" && typeof (body as CashActionError).error === "string"
            ? (body as CashActionError).error
            : "Não foi possível consultar o caixa";
        throw new Error(message);
      }
      saveResponse(body as CashSessionResponse);
      setOffline(false);
    } catch (cause) {
      const cached = readCached(userId, storeId);
      if (cached?.session?.terminal_id === terminalId) {
        setResponse(cached);
        setOffline(true);
      } else {
        setResponse(null);
      }
      setError(cause instanceof Error ? cause.message : "Não foi possível consultar o caixa");
    } finally {
      setLoading(false);
    }
  }, [fixtures, saveResponse, storeId, terminalId, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      const result = await fetch("/api/cash/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await result.json().catch(() => null);
      if (!result.ok) {
        const message =
          body && typeof body === "object" && typeof (body as CashActionError).error === "string"
            ? (body as CashActionError).error
            : "Operação de caixa rejeitada";
        throw new CashActionRejected(message);
      }
    },
    []
  );

  const openSession = useCallback(
    async (openingAmount: string) => {
      if (!storeId || !terminalId) throw new Error("Terminal ainda não identificado");
      if (offline) throw new Error("Operações de caixa exigem conexão");
      const operationKey = `open:${terminalId}`;
      const clientMutationId = getPendingMutation(operationKey);
      setMutating(true);
      setError(null);
      try {
        if (fixtures) {
          const next = fixtureResponse(storeId, terminalId);
          next.session!.opening_amount = openingAmount;
          next.session!.expected_amount = openingAmount;
          next.expected_amount = openingAmount;
          saveResponse(next);
          clearPendingMutation(operationKey);
          return;
        }
        await mutate({
          action: "open",
          store_id: storeId,
          terminal_id: terminalId,
          client_mutation_id: clientMutationId,
          opening_amount: openingAmount,
        });
        clearPendingMutation(operationKey);
        await refresh();
      } catch (cause) {
        if (cause instanceof CashActionRejected) clearPendingMutation(operationKey);
        setError(cause instanceof Error ? cause.message : "Não foi possível abrir o caixa");
        throw cause;
      } finally {
        setMutating(false);
      }
    },
    [
      clearPendingMutation,
      fixtures,
      getPendingMutation,
      mutate,
      offline,
      refresh,
      saveResponse,
      storeId,
      terminalId,
    ]
  );

  const recordMovement = useCallback(
    async (
      movementType: "supply" | "withdrawal" | "adjustment",
      amount: string,
      reason: string
    ) => {
      const current = response;
      const session = current?.session;
      if (!storeId || !terminalId || !session || session.status !== "open") {
        throw new Error("Abra o caixa antes de registrar uma movimentação");
      }
      if (offline) {
        throw new Error("Movimentações de caixa exigem conexão");
      }
      const operationKey = `movement:${session.cash_session_id}`;
      const clientMutationId = getPendingMutation(operationKey);
      setMutating(true);
      setError(null);
      try {
        if (fixtures) {
          const movement = fixtureMovement(
            storeId,
            terminalId,
            session.cash_session_id,
            movementType,
            amount,
            reason
          );
          const movements = [...current.movements, movement];
          const expectedAmount = calculateExpectedCash(session.opening_amount, movements);
          saveResponse({
            ...current,
            movements,
            expected_amount: expectedAmount,
            session: { ...session, expected_amount: expectedAmount },
          });
          clearPendingMutation(operationKey);
          return;
        }
        await mutate({
          action: "movement",
          cash_session_id: session.cash_session_id,
          store_id: storeId,
          terminal_id: terminalId,
          client_mutation_id: clientMutationId,
          movement_type: movementType,
          amount,
          reason,
        });
        clearPendingMutation(operationKey);
        await refresh();
      } catch (cause) {
        if (cause instanceof CashActionRejected) clearPendingMutation(operationKey);
        setError(cause instanceof Error ? cause.message : "Não foi possível registrar a movimentação");
        throw cause;
      } finally {
        setMutating(false);
      }
    },
    [
      clearPendingMutation,
      fixtures,
      getPendingMutation,
      mutate,
      offline,
      refresh,
      response,
      saveResponse,
      storeId,
      terminalId,
    ]
  );

  const closeSession = useCallback(
    async (countedAmount: string) => {
      const current = response;
      const session = current?.session;
      if (!storeId || !terminalId || !session || session.status !== "open") {
        throw new Error("Não há caixa aberto para fechar");
      }
      if (offline) {
        throw new Error("Fechamento de caixa exige conexão");
      }
      const operationKey = `close:${session.cash_session_id}`;
      const clientMutationId = getPendingMutation(operationKey);
      setMutating(true);
      setError(null);
      try {
        if (fixtures) {
          const difference = calculateCashDifference(countedAmount, current.expected_amount);
          saveResponse({
            ...current,
            session: {
              ...session,
              status: "closed",
              counted_amount: countedAmount,
              difference,
              expected_amount: current.expected_amount,
              closed_by: FIXTURE_USER_ID,
              closed_at: new Date().toISOString(),
            },
          });
          clearPendingMutation(operationKey);
          return;
        }
        await mutate({
          action: "close",
          cash_session_id: session.cash_session_id,
          store_id: storeId,
          terminal_id: terminalId,
          client_mutation_id: clientMutationId,
          counted_amount: countedAmount,
        });
        clearPendingMutation(operationKey);
        await refresh();
      } catch (cause) {
        if (cause instanceof CashActionRejected) clearPendingMutation(operationKey);
        setError(cause instanceof Error ? cause.message : "Não foi possível fechar o caixa");
        throw cause;
      } finally {
        setMutating(false);
      }
    },
    [
      clearPendingMutation,
      fixtures,
      getPendingMutation,
      mutate,
      offline,
      refresh,
      response,
      saveResponse,
      storeId,
      terminalId,
    ]
  );

  const canSell = Boolean(response?.session?.status === "open");
  const expectedAmount = response?.expected_amount ?? "0.00";
  return useMemo(
    () => ({
      terminalId,
      response,
      session: response?.session ?? null,
      movements: response?.movements ?? [],
      expectedAmount,
      loading,
      mutating,
      offline,
      error,
      canSell,
      openSession,
      recordMovement,
      closeSession,
      refresh,
    }),
    [
      canSell,
      closeSession,
      error,
      expectedAmount,
      loading,
      mutating,
      offline,
      openSession,
      recordMovement,
      refresh,
      response,
      terminalId,
    ]
  );
}

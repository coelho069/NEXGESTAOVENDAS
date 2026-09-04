"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  createSnapshotFromCart,
  type SuspendedCartContext,
  type SuspendedSaleRecovery,
  type SuspendedSaleSnapshot,
  type SuspendedSaleSummary,
} from "@/lib/domain/suspended-sale";
import type { CartLine } from "@/lib/domain/sale";
import { getTerminalId } from "@/lib/offline/terminal-identity";
import { pdvFixturesEnabled } from "@/lib/pdv/fixtures";

const FIXTURE_STORAGE_KEY = "nex-pdv-suspended-sales-fixture-v1";
const RECOVERY_MUTATION_KEY_PREFIX = "nex-pdv-suspended-recovery:";
const FIXTURE_OPERATOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FIXTURE_ORG_ID = "11111111-1111-4111-8111-111111111111";

type FixtureSuspendedRow = SuspendedSaleSummary & {
  storeId: string;
  snapshot: SuspendedSaleSnapshot;
  claimId: string | null;
  claimedBy: string | null;
  claimedTerminalId: string | null;
  recoveryMutationId: string | null;
};

type SuspendCartInput = {
  storeId: string;
  lines: CartLine[];
  discount: string;
  customerId: string | null;
  customerName: string | null;
  notes?: string;
};

type SuspendedListResponse = {
  rows: SuspendedSaleSummary[];
  has_more: boolean;
  next_cursor: { after_created_at: string; after_id: string } | null;
};

export function useSuspendedSales(storeId: string | null) {
  const fixtures = pdvFixturesEnabled();
  const [rows, setRows] = useState<SuspendedSaleSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suspendMutationId = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!storeId) {
      setRows([]);
      return [];
    }

    setLoading(true);
    setError(null);
    try {
      if (fixtures) {
        const next = readFixtureRows()
          .filter((row) => row.storeId === storeId)
          .map(toSummary);
        setRows(next);
        return next;
      }

      const response = await fetch(
        `/api/suspended-sales?${new URLSearchParams({ store_id: storeId }).toString()}`,
        { cache: "no-store", credentials: "include" }
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readError(body, "Não foi possível consultar vendas suspensas"));
      const payload = body as Partial<SuspendedListResponse>;
      const next = Array.isArray(payload.rows) ? payload.rows : [];
      setRows(next);
      return next;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Não foi possível consultar vendas suspensas";
      setError(message);
      throw cause;
    } finally {
      setLoading(false);
    }
  }, [fixtures, storeId]);

  useEffect(() => {
    if (storeId) void refresh().catch(() => undefined);
  }, [refresh, storeId]);

  const suspend = useCallback(
    async (input: Omit<SuspendCartInput, "storeId">) => {
      if (!storeId) throw new Error("Selecione uma loja autorizada");
      assertOnline("Suspender venda exige conexão com o servidor.");
      const mutationId = suspendMutationId.current ?? uuidv4();
      suspendMutationId.current = mutationId;
      setMutating(true);
      setError(null);
      try {
        if (fixtures) {
          const existing = readFixtureRows().find(
            (row) => row.storeId === storeId && row.snapshot.client_mutation_id === mutationId
          );
          if (existing) {
            suspendMutationId.current = null;
            return toSummary(existing);
          }

          const snapshot = createSnapshotFromCart({
            orgId: FIXTURE_ORG_ID,
            storeId,
            operatorId: FIXTURE_OPERATOR_ID,
            terminalId: getTerminalId(),
            clientMutationId: mutationId,
            ...input,
          });
          const now = new Date().toISOString();
          const row: FixtureSuspendedRow = {
            storeId,
            suspended_sale_id: uuidv4(),
            status: "suspended",
            operator_id: FIXTURE_OPERATOR_ID,
            terminal_id: snapshot.terminal_id,
            customer_id: snapshot.customer_id,
            customer_name: snapshot.customer_name,
            item_count: snapshot.items.length,
            subtotal: snapshot.subtotal,
            discount: snapshot.discount,
            total: snapshot.total,
            created_at: now,
            updated_at: now,
            claimed_at: null,
            snapshot,
            claimId: null,
            claimedBy: null,
            claimedTerminalId: null,
            recoveryMutationId: null,
          };
          writeFixtureRows([...readFixtureRows(), row]);
          setRows((current) => [toSummary(row), ...current]);
          suspendMutationId.current = null;
          return toSummary(row);
        }

        const response = await fetch("/api/suspended-sales", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            store_id: storeId,
            client_mutation_id: mutationId,
            terminal_id: getTerminalId(),
            customer_id: input.customerId ?? undefined,
            discount: input.discount,
            notes: input.notes,
            items: input.lines.map((line) => ({
              product_id: line.productId,
              quantity: line.quantity,
              unit_price: line.unitPrice,
              discount: line.discount,
            })),
          }),
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error(readError(body, "Não foi possível suspender a venda"));
        await refresh();
        suspendMutationId.current = null;
        return body as {
          suspended_sale_id: string;
          status: "suspended";
          total: string;
        };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Não foi possível suspender a venda";
        setError(message);
        throw cause;
      } finally {
        setMutating(false);
      }
    },
    [fixtures, refresh, storeId]
  );

  const recover = useCallback(
    async (suspendedSaleId: string): Promise<SuspendedSaleRecovery> => {
      if (!storeId) throw new Error("Selecione uma loja autorizada");
      assertOnline("Recuperar venda exige conexão com o servidor.");
      const terminalId = getTerminalId();
      const mutationId = getRecoveryMutationId(storeId, suspendedSaleId);
      setMutating(true);
      setError(null);
      try {
        if (fixtures) {
          const allRows = readFixtureRows();
          const row = allRows.find(
            (candidate) =>
              candidate.suspended_sale_id === suspendedSaleId && candidate.storeId === storeId
          );
          if (!row) throw new Error("suspended_sale_not_found");
          if (row.status === "claimed") {
            if (
              row.recoveryMutationId !== mutationId ||
              row.claimedTerminalId !== terminalId
            ) {
              throw new Error("suspended_sale_conflict");
            }
            return {
              suspended_sale_id: row.suspended_sale_id,
              status: "claimed",
              claim_id: row.claimId!,
              store_id: storeId,
              terminal_id: terminalId,
              snapshot: row.snapshot,
              replay: true,
            };
          }
          const claimId = uuidv4();
          const next: FixtureSuspendedRow = {
            ...row,
            status: "claimed",
            updated_at: new Date().toISOString(),
            claimed_at: new Date().toISOString(),
            claimId,
            claimedBy: FIXTURE_OPERATOR_ID,
            claimedTerminalId: terminalId,
            recoveryMutationId: mutationId,
          };
          writeFixtureRows(allRows.map((candidate) =>
            candidate.suspended_sale_id === row.suspended_sale_id ? next : candidate
          ));
          setRows((current) => current.map((candidate) =>
            candidate.suspended_sale_id === row.suspended_sale_id ? toSummary(next) : candidate
          ));
          return {
            suspended_sale_id: next.suspended_sale_id,
            status: "claimed",
            claim_id: claimId,
            store_id: storeId,
            terminal_id: terminalId,
            snapshot: next.snapshot,
            replay: false,
          };
        }

        const response = await fetch(`/api/suspended-sales/${suspendedSaleId}/recover`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            store_id: storeId,
            terminal_id: terminalId,
            recovery_client_mutation_id: mutationId,
          }),
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error(readError(body, "Não foi possível recuperar a venda"));
        const recovery = body as SuspendedSaleRecovery;
        await refresh();
        return recovery;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Não foi possível recuperar a venda";
        setError(message);
        throw cause;
      } finally {
        setMutating(false);
      }
    },
    [fixtures, refresh, storeId]
  );

  const release = useCallback(
    async (context: SuspendedCartContext) => {
      if (!storeId) throw new Error("Selecione uma loja autorizada");
      assertOnline("Liberar venda exige conexão com o servidor.");
      setMutating(true);
      setError(null);
      try {
        if (fixtures) {
          const allRows = readFixtureRows();
          const row = allRows.find(
            (candidate) =>
              candidate.suspended_sale_id === context.suspendedSaleId &&
              candidate.storeId === storeId
          );
          if (!row) throw new Error("suspended_sale_not_found");
          if (row.status === "suspended") return;
          if (row.claimId !== context.claimId) throw new Error("suspended_sale_conflict");
          const next: FixtureSuspendedRow = {
            ...row,
            status: "suspended",
            updated_at: new Date().toISOString(),
            claimed_at: null,
            claimId: null,
            claimedBy: null,
            claimedTerminalId: null,
            recoveryMutationId: null,
          };
          writeFixtureRows(allRows.map((candidate) =>
            candidate.suspended_sale_id === row.suspended_sale_id ? next : candidate
          ));
          setRows((current) => current.map((candidate) =>
            candidate.suspended_sale_id === row.suspended_sale_id ? toSummary(next) : candidate
          ));
          return;
        }

        const response = await fetch(`/api/suspended-sales/${context.suspendedSaleId}/release`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ store_id: storeId, claim_id: context.claimId }),
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error(readError(body, "Não foi possível liberar a venda"));
        await refresh();
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Não foi possível liberar a venda";
        setError(message);
        throw cause;
      } finally {
        setMutating(false);
      }
    },
    [fixtures, refresh, storeId]
  );

  return { rows, loading, mutating, error, refresh, suspend, recover, release };
}

function assertOnline(message: string): void {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error(message);
  }
}

function getRecoveryMutationId(storeId: string, suspendedSaleId: string): string {
  const key = `${RECOVERY_MUTATION_KEY_PREFIX}${storeId}:${suspendedSaleId}`;
  if (typeof sessionStorage === "undefined") return uuidv4();
  const current = sessionStorage.getItem(key);
  if (current) return current;
  const next = uuidv4();
  sessionStorage.setItem(key, next);
  return next;
}

function readError(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
    const code = (body as { error: string }).error;
    const messages: Record<string, string> = {
      forbidden_store: "Você não tem acesso a esta loja.",
      idempotency_payload_mismatch: "A tentativa usa a mesma chave com dados diferentes.",
      suspended_sale_conflict: "Esta venda suspensa já foi recuperada por outra operação.",
      suspended_sale_not_found: "Venda suspensa não encontrada.",
      suspended_sale_validation_failed: "A venda suspensa não passou na validação de integridade.",
    };
    return messages[code] ?? code;
  }
  return fallback;
}

function readFixtureRows(): FixtureSuspendedRow[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(FIXTURE_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as FixtureSuspendedRow[]) : [];
  } catch {
    return [];
  }
}

function writeFixtureRows(rows: FixtureSuspendedRow[]): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(FIXTURE_STORAGE_KEY, JSON.stringify(rows));
  }
}

function toSummary(row: FixtureSuspendedRow): SuspendedSaleSummary {
  return {
    suspended_sale_id: row.suspended_sale_id,
    status: row.status,
    operator_id: row.operator_id,
    terminal_id: row.terminal_id,
    customer_id: row.customer_id,
    customer_name: row.customer_name,
    item_count: row.item_count,
    subtotal: row.subtotal,
    discount: row.discount,
    total: row.total,
    created_at: row.created_at,
    updated_at: row.updated_at,
    claimed_at: row.claimed_at,
  };
}

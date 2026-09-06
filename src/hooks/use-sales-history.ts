"use client";

import { useCallback, useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  buildLocalSaleHistoryDetail,
  buildLocalSaleHistoryList,
  type SaleHistoryDetail,
  type SaleHistoryListItem,
  type SaleHistoryListResponse,
} from "@/lib/domain/sale-history";
import {
  enrichLocalSaleDetailWithReturns,
  processFixtureSaleReturn,
} from "@/lib/domain/sale-return-local";
import type { SaleReturnOperation, SaleReturnReason } from "@/lib/domain/sale-return";
import { getPdvLocalDbForUser } from "@/lib/offline/pdv-local-db";
import { getTerminalId } from "@/lib/offline/terminal-identity";
import { pdvFixturesEnabled } from "@/lib/pdv/fixtures";
import { useSessionStore } from "@/stores/session-store";

function readError(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return fallback;
}

export function useSalesHistory(storeId: string | null) {
  const [rows, setRows] = useState<SaleHistoryListItem[]>([]);
  const [detail, setDetail] = useState<SaleHistoryDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<SaleHistoryListResponse["next_cursor"]>(null);
  const [mutating, setMutating] = useState(false);

  const loadLocal = useCallback(
    async (search: string): Promise<SaleHistoryListResponse> => {
      const db = getPdvLocalDbForUser(useSessionStore.getState().userId);
      const sales = storeId
        ? await db.sales.where("storeId").equals(storeId).toArray()
        : [];
      const payments = await db.payments.toArray();
      const scopedPayments = payments.filter((payment) =>
        sales.some((sale) => sale.id === payment.saleId)
      );
      return buildLocalSaleHistoryList(sales, scopedPayments, { query: search, limit: 20 });
    },
    [storeId]
  );

  const refresh = useCallback(async () => {
    if (!storeId) {
      setRows([]);
      setHasMore(false);
      setNextCursor(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (pdvFixturesEnabled() || (typeof navigator !== "undefined" && !navigator.onLine)) {
        const local = await loadLocal(query);
        setRows(local.rows);
        setHasMore(local.has_more);
        setNextCursor(local.next_cursor);
        return;
      }

      const params = new URLSearchParams({
        store_id: storeId,
        limit: "20",
      });
      if (query.trim()) params.set("query", query.trim());

      const response = await fetch(`/api/sales?${params.toString()}`, {
        method: "GET",
        credentials: "same-origin",
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(readError(body, "Não foi possível consultar vendas"));
      }
      const payload = body as SaleHistoryListResponse;
      setRows(Array.isArray(payload.rows) ? payload.rows : []);
      setHasMore(Boolean(payload.has_more));
      setNextCursor(payload.next_cursor ?? null);
    } catch (cause) {
      try {
        const local = await loadLocal(query);
        setRows(local.rows);
        setHasMore(local.has_more);
        setNextCursor(local.next_cursor);
        setError(
          cause instanceof Error
            ? `${cause.message}. Exibindo histórico local.`
            : "Exibindo histórico local."
        );
      } catch {
        setError(cause instanceof Error ? cause.message : "Não foi possível consultar vendas");
      }
    } finally {
      setLoading(false);
    }
  }, [loadLocal, query, storeId]);

  const loadMore = useCallback(async () => {
    if (!storeId || !nextCursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      if (pdvFixturesEnabled() || (typeof navigator !== "undefined" && !navigator.onLine)) {
        setHasMore(false);
        setNextCursor(null);
        return;
      }

      const params = new URLSearchParams({
        store_id: storeId,
        limit: "20",
        after_created_at: nextCursor.after_created_at,
        after_id: nextCursor.after_id,
      });
      if (query.trim()) params.set("query", query.trim());

      const response = await fetch(`/api/sales?${params.toString()}`, {
        method: "GET",
        credentials: "same-origin",
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(readError(body, "Não foi possível carregar mais vendas"));
      }
      const payload = body as SaleHistoryListResponse;
      setRows((current) => [...current, ...(Array.isArray(payload.rows) ? payload.rows : [])]);
      setHasMore(Boolean(payload.has_more));
      setNextCursor(payload.next_cursor ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar mais vendas");
    } finally {
      setLoading(false);
    }
  }, [loading, nextCursor, query, storeId]);

  const openDetail = useCallback(
    async (saleId: string) => {
      if (!storeId) return;
      setDetailLoading(true);
      setError(null);
      try {
        if (pdvFixturesEnabled() || (typeof navigator !== "undefined" && !navigator.onLine)) {
          const db = getPdvLocalDbForUser(useSessionStore.getState().userId);
          const sale =
            (await db.sales.get(saleId)) ??
            (await db.sales.filter((row) => row.serverSaleId === saleId).first());
          if (!sale || sale.storeId !== storeId) {
            throw new Error("Venda não encontrada no histórico local");
          }
          const items = await db.saleItems.where("saleId").equals(sale.id).toArray();
          const payments = await db.payments.where("saleId").equals(sale.id).toArray();
          setDetail(
            enrichLocalSaleDetailWithReturns(buildLocalSaleHistoryDetail(sale, items, payments))
          );
          return;
        }

        const params = new URLSearchParams({ store_id: storeId });
        const response = await fetch(`/api/sales/${saleId}?${params.toString()}`, {
          method: "GET",
          credentials: "same-origin",
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(readError(body, "Não foi possível abrir a venda"));
        }
        setDetail(body as SaleHistoryDetail);
      } catch (cause) {
        setDetail(null);
        setError(cause instanceof Error ? cause.message : "Não foi possível abrir a venda");
      } finally {
        setDetailLoading(false);
      }
    },
    [storeId]
  );

  const submitReturn = useCallback(
    async (input: {
      saleId: string;
      operation: SaleReturnOperation;
      reason: SaleReturnReason;
      notes?: string;
      items: Array<{ sale_item_id: string; quantity: string }>;
      cashSessionId?: string | null;
    }) => {
      if (!storeId) throw new Error("Selecione uma loja");
      setMutating(true);
      setError(null);
      const clientMutationId = uuidv4();
      try {
        if (pdvFixturesEnabled()) {
          const db = getPdvLocalDbForUser(useSessionStore.getState().userId);
          const result = await processFixtureSaleReturn({
            db,
            storeId,
            saleId: input.saleId,
            operation: input.operation,
            reason: input.reason,
            notes: input.notes,
            clientMutationId,
            items: input.items,
          });
          await openDetail(input.saleId);
          await refresh();
          return result;
        }

        const response = await fetch(`/api/sales/${input.saleId}/return`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            store_id: storeId,
            sale_id: input.saleId,
            terminal_id: getTerminalId(),
            cash_session_id: input.cashSessionId ?? undefined,
            client_mutation_id: clientMutationId,
            operation: input.operation,
            reason: input.reason,
            notes: input.notes,
            items: input.items,
          }),
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(readError(body, "Não foi possível processar a devolução"));
        }
        await openDetail(input.saleId);
        await refresh();
        return body as {
          return_id: string;
          sale_id: string;
          operation: SaleReturnOperation;
          sale_status: string;
          refund_total: string;
          payment_refund_status: string;
          payment_method: string;
          replay: boolean;
        };
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "Não foi possível processar a devolução";
        setError(message);
        throw cause;
      } finally {
        setMutating(false);
      }
    },
    [openDetail, refresh, storeId]
  );

  useEffect(() => {
    void refresh();
    // Refresh on store change only; search applies when the operator clicks Atualizar.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: avoid per-keystroke fetch
  }, [storeId]);

  return {
    rows,
    detail,
    loading,
    detailLoading,
    mutating,
    error,
    query,
    hasMore,
    setQuery,
    refresh,
    loadMore,
    openDetail,
    submitReturn,
    clearDetail: () => setDetail(null),
    clearError: () => setError(null),
  };
}

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  parseCustomerSalesResponse,
  type CustomerSalesListItem,
  type CustomerSalesResponse,
  type CustomerSalesSummary,
} from "@/lib/domain/customer-sales";
import { SALES_HISTORY_SYNC_EVENT } from "@/lib/pdv/sales-history-sync";

function readError(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return fallback;
}

const EMPTY_SUMMARY: CustomerSalesSummary = {
  lifetime_revenue: "0.00",
  sales_count: 0,
  last_sale_at: null,
};

export function useCustomerSales(customerId: string | null) {
  const [summary, setSummary] = useState<CustomerSalesSummary>(EMPTY_SUMMARY);
  const [rows, setRows] = useState<CustomerSalesListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<CustomerSalesResponse["next_cursor"]>(null);

  const applyPayload = useCallback((payload: CustomerSalesResponse, append: boolean) => {
    setSummary(payload.summary);
    setRows((current) => (append ? [...current, ...payload.rows] : payload.rows));
    setHasMore(payload.has_more);
    setNextCursor(payload.next_cursor);
  }, []);

  const refresh = useCallback(async () => {
    if (!customerId) {
      setSummary(EMPTY_SUMMARY);
      setRows([]);
      setHasMore(false);
      setNextCursor(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/customers/${customerId}/sales?limit=20`, {
        method: "GET",
        credentials: "same-origin",
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(readError(body, "Não foi possível carregar vendas do cliente"));
      }
      const payload = parseCustomerSalesResponse(body);
      if (!payload) {
        throw new Error("Resposta inválida do histórico de vendas");
      }
      applyPayload(payload, false);
    } catch (cause) {
      setSummary(EMPTY_SUMMARY);
      setRows([]);
      setHasMore(false);
      setNextCursor(null);
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar vendas do cliente");
    } finally {
      setLoading(false);
    }
  }, [applyPayload, customerId]);

  const loadMore = useCallback(async () => {
    if (!customerId || !nextCursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: "20",
        after_created_at: nextCursor.after_created_at,
        after_id: nextCursor.after_id,
      });
      const response = await fetch(`/api/customers/${customerId}/sales?${params.toString()}`, {
        method: "GET",
        credentials: "same-origin",
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(readError(body, "Não foi possível carregar mais vendas"));
      }
      const payload = parseCustomerSalesResponse(body);
      if (!payload) {
        throw new Error("Resposta inválida do histórico de vendas");
      }
      applyPayload(payload, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar mais vendas");
    } finally {
      setLoading(false);
    }
  }, [applyPayload, customerId, loading, nextCursor]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when customerId changes only
  }, [customerId]);

  useEffect(() => {
    const handleSync = () => {
      void refresh();
    };
    window.addEventListener(SALES_HISTORY_SYNC_EVENT, handleSync);
    return () => window.removeEventListener(SALES_HISTORY_SYNC_EVENT, handleSync);
  }, [refresh]);

  return {
    summary,
    rows,
    loading,
    error,
    hasMore,
    refresh,
    loadMore,
  };
}

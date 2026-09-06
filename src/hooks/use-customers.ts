"use client";

import { useCallback, useEffect, useState } from "react";
import type { CatalogCustomer } from "@/lib/domain/catalog";
import type {
  CustomerDetailResponse,
  CustomerRecord,
  CustomerSearchResponse,
} from "@/lib/domain/customer";
import { pdvFixturesEnabled } from "@/lib/pdv/fixtures";
import {
  asCatalogCustomers,
  getFixtureCustomerDetail,
  listFixtureCustomers,
  searchFixtureCustomers,
  upsertFixtureCustomer,
} from "@/lib/pdv/customer-fixtures";

function readError(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    if (body.error === "customer_document_conflict") return "Já existe cliente com este documento";
    if (body.error === "customer_validation_failed" && "message" in body && typeof body.message === "string") {
      return body.message;
    }
    return body.error;
  }
  return fallback;
}

export function useCustomers(storeId: string | null) {
  const [customers, setCustomers] = useState<CatalogCustomer[]>(() =>
    pdvFixturesEnabled() ? asCatalogCustomers(listFixtureCustomers()) : []
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [detail, setDetail] = useState<CustomerDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const applyCustomerRows = useCallback((rows: CustomerRecord[]) => {
    const next = asCatalogCustomers(rows);
    setCustomers((current) => {
      if (
        current.length === next.length &&
        current.every(
          (row, index) =>
            row.id === next[index]?.id &&
            row.name === next[index]?.name &&
            row.document === next[index]?.document
        )
      ) {
        return current;
      }
      return next;
    });
  }, []);

  const search = useCallback(
    async (query: string): Promise<CustomerSearchResponse> => {
      if (!storeId) {
        return { rows: [], has_more: false, next_cursor: null };
      }

      if (pdvFixturesEnabled()) {
        const local = searchFixtureCustomers(query, 50);
        applyCustomerRows(local.rows);
        return local;
      }

      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          store_id: storeId,
          limit: "50",
        });
        if (query.trim()) params.set("query", query.trim());
        const response = await fetch(`/api/customers?${params.toString()}`, {
          method: "GET",
          credentials: "same-origin",
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(readError(body, "Não foi possível buscar clientes"));
        }
        const payload = body as CustomerSearchResponse;
        const rows = Array.isArray(payload.rows) ? payload.rows : [];
        applyCustomerRows(rows);
        return {
          rows,
          has_more: Boolean(payload.has_more),
          next_cursor: payload.next_cursor ?? null,
        };
      } catch (cause) {
        setCustomers([]);
        setError(cause instanceof Error ? cause.message : "Não foi possível buscar clientes");
        return { rows: [], has_more: false, next_cursor: null };
      } finally {
        setLoading(false);
      }
    },
    [applyCustomerRows, storeId]
  );

  const reload = useCallback(async () => {
    if (pdvFixturesEnabled()) {
      applyCustomerRows(listFixtureCustomers());
      return;
    }
    await search("");
  }, [applyCustomerRows, search]);

  const save = useCallback(
    async (input: {
      customerId?: string;
      name: string;
      document?: string | null;
      email?: string | null;
      phone?: string | null;
      requireDocument?: boolean;
    }): Promise<CustomerRecord> => {
      if (!storeId) throw new Error("Selecione uma loja");
      setMutating(true);
      setError(null);
      try {
        if (pdvFixturesEnabled()) {
          const saved = upsertFixtureCustomer(input);
          await reload();
          return saved;
        }

        const response = await fetch(
          input.customerId ? `/api/customers/${input.customerId}` : "/api/customers",
          {
            method: input.customerId ? "PATCH" : "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              store_id: storeId,
              customer_id: input.customerId,
              name: input.name,
              document: input.document,
              email: input.email,
              phone: input.phone,
            }),
          }
        );
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(readError(body, "Não foi possível salvar o cliente"));
        }
        const saved = body as CustomerRecord;
        await reload();
        return saved;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Não foi possível salvar o cliente";
        setError(message);
        throw cause;
      } finally {
        setMutating(false);
      }
    },
    [reload, storeId]
  );

  const openDetail = useCallback(
    async (customerId: string) => {
      if (!storeId) return;
      setDetailLoading(true);
      setError(null);
      try {
        if (pdvFixturesEnabled()) {
          setDetail(getFixtureCustomerDetail(customerId));
          return;
        }
        const params = new URLSearchParams({ store_id: storeId, limit: "20" });
        const response = await fetch(`/api/customers/${customerId}?${params.toString()}`, {
          method: "GET",
          credentials: "same-origin",
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(readError(body, "Não foi possível abrir o cliente"));
        }
        setDetail(body as CustomerDetailResponse);
      } catch (cause) {
        setDetail(null);
        setError(cause instanceof Error ? cause.message : "Não foi possível abrir o cliente");
      } finally {
        setDetailLoading(false);
      }
    },
    [storeId]
  );

  const clearDetail = useCallback(() => setDetail(null), []);
  const clearError = useCallback(() => setError(null), []);

  const loadMoreDetail = useCallback(async () => {
    if (!storeId || !detail || !detail.has_more || !detail.next_cursor || detailLoading) return;

    setDetailLoading(true);
    setError(null);
    try {
      if (pdvFixturesEnabled()) {
        setDetail((current) =>
          current ? { ...current, has_more: false, next_cursor: null } : current
        );
        return;
      }

      const params = new URLSearchParams({
        store_id: storeId,
        limit: "20",
        after_created_at: detail.next_cursor.after_created_at,
        after_id: detail.next_cursor.after_id,
      });
      const response = await fetch(`/api/customers/${detail.customer.id}?${params.toString()}`, {
        method: "GET",
        credentials: "same-origin",
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(readError(body, "Não foi possível carregar o histórico do cliente"));
      }

      const next = body as CustomerDetailResponse;
      setDetail((current) => {
        if (!current || current.customer.id !== next.customer.id) return next;
        return {
          ...next,
          sales: [...current.sales, ...next.sales],
        };
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar o histórico do cliente"
      );
    } finally {
      setDetailLoading(false);
    }
  }, [detail, detailLoading, storeId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    customers,
    error,
    loading,
    mutating,
    detail,
    detailLoading,
    reload,
    search,
    save,
    openDetail,
    loadMoreDetail,
    clearDetail,
    clearError,
  };
}

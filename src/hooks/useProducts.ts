"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchProducts } from "@/lib/catalog-api";
import { filterActiveProducts, searchProducts, type ProductRow } from "@/lib/domain/product";
import { fixtureProducts, pdvFixturesEnabled } from "@/lib/pdv/fixtures";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

type UseProductsOptions = {
  query?: string;
  debounceMs?: number;
  cacheTtlMs?: number;
  scopeKey?: string;
  storeId?: string | null;
};

export function useProducts(options: UseProductsOptions = {}) {
  const {
    query = "",
    debounceMs = 300,
    cacheTtlMs,
    scopeKey = "default",
    storeId = null,
  } = options;
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"catalog" | "fixtures" | null>(null);
  const debouncedQuery = useDebouncedValue(query, debounceMs);

  const load = useCallback(async () => {
    setLoading(true);

    if (!storeId && !pdvFixturesEnabled()) {
      setProducts([]);
      setSource(null);
      setError("Selecione uma loja autorizada");
      setLoading(false);
      return;
    }

    try {
      const nextProducts = await fetchProducts({ cacheTtlMs, scopeKey, storeId });
      setProducts(nextProducts);
      setSource("catalog");
      setError(null);
    } catch {
      const fallback = pdvFixturesEnabled() ? filterActiveProducts(fixtureProducts()) : [];
      setProducts(fallback);
      setSource(fallback.length > 0 ? "fixtures" : null);
      setError(fallback.length > 0 ? null : "Falha ao carregar catálogo");
    } finally {
      setLoading(false);
    }
  }, [cacheTtlMs, scopeKey, storeId]);

  useEffect(() => {
    // Initial catalog loading synchronizes this client with Supabase.
    void load();
  }, [load]);

  const filteredProducts = useMemo(
    () => searchProducts(products, debouncedQuery),
    [debouncedQuery, products]
  );

  return {
    products,
    filteredProducts,
    loading,
    error,
    source,
    query: debouncedQuery,
    reload: load,
  };
}

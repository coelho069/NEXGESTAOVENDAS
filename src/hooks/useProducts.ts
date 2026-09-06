"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchProducts } from "@/lib/catalog-api";
import {
  catalogLoadCauseFromUnknown,
  resolveCatalogLoad,
} from "@/lib/domain/catalog-load";
import { filterActiveProducts, searchProducts, type ProductRow } from "@/lib/domain/product";
import { fixtureProducts, pdvFixturesEnabled } from "@/lib/pdv/fixtures";
import { createClient } from "@/lib/supabase/client";
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
    } catch (cause) {
      const resolved = resolveCatalogLoad({
        failed: true,
        data: null,
        fixtures: pdvFixturesEnabled(),
        fixtureProducts: filterActiveProducts(fixtureProducts()),
        cause: catalogLoadCauseFromUnknown(cause),
      });
      setProducts(resolved.products);
      setSource(resolved.products.length > 0 ? "fixtures" : null);
      setError(resolved.error);
    } finally {
      setLoading(false);
    }
  }, [cacheTtlMs, scopeKey, storeId]);

  useEffect(() => {
    // Reload when storeId becomes available or changes.
    void load();
  }, [load]);

  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }

    const { data } = supabase.auth.onAuthStateChange(() => {
      void load();
    });

    return () => {
      data.subscription.unsubscribe();
    };
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

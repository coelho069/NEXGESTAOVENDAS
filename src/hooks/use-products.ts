"use client";

import { useCallback, useEffect, useState } from "react";
import { filterActiveProducts, type ProductRow } from "@/lib/domain/product";
import {
  catalogLoadCauseFromUnknown,
  resolveCatalogLoad,
  type CatalogLoadCause,
} from "@/lib/domain/catalog-load";
import { fixtureProducts, pdvFixturesEnabled } from "@/lib/pdv/fixtures";
import { createClient } from "@/lib/supabase/client";

function applyCatalogResult(
  failed: boolean,
  data: ProductRow[] | null,
  cause?: CatalogLoadCause | string | null
) {
  const resolved = resolveCatalogLoad({
    failed,
    data: data ? filterActiveProducts(data) : null,
    fixtures: pdvFixturesEnabled(),
    fixtureProducts: filterActiveProducts(fixtureProducts()),
    cause,
  });
  return resolved;
}

export function useProducts(options: { storeId?: string | null } = {}) {
  const { storeId = null } = options;
  const [products, setProducts] = useState<ProductRow[]>(() =>
    pdvFixturesEnabled() ? filterActiveProducts(fixtureProducts()) : []
  );
  const [loading, setLoading] = useState(() => !pdvFixturesEnabled());
  const [error, setError] = useState<string | null>(null);
  const [fromCatalog, setFromCatalog] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    if (!storeId && !pdvFixturesEnabled()) {
      setProducts([]);
      setFromCatalog(false);
      setError("Selecione uma loja autorizada");
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      const { data, error: queryError } = await supabase
        .from("products")
        .select("id, sku, name, unit_price, barcode, category_id, is_active")
        .order("name");

      const resolved = applyCatalogResult(
        Boolean(queryError) || !data,
        (data as ProductRow[] | null) ?? null,
        queryError ? { message: queryError.message, code: queryError.code } : null
      );
      setProducts(resolved.products);
      setFromCatalog(false);
      setError(resolved.error);
    } catch (cause) {
      const resolved = applyCatalogResult(true, null, catalogLoadCauseFromUnknown(cause));
      setProducts(resolved.products);
      setFromCatalog(false);
      setError(resolved.error);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

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

  return { products, loading, error, reload: load, fromCatalog };
}

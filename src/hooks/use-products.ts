"use client";

import { useCallback, useEffect, useState } from "react";
import { filterActiveProducts, type ProductRow } from "@/lib/domain/product";
import { resolveCatalogLoad } from "@/lib/domain/catalog-load";
import { fixtureProducts, pdvFixturesEnabled } from "@/lib/pdv/fixtures";
import { createClient } from "@/lib/supabase/client";

function applyCatalogResult(failed: boolean, data: ProductRow[] | null) {
  const resolved = resolveCatalogLoad({
    failed,
    data: data ? filterActiveProducts(data) : null,
    fixtures: pdvFixturesEnabled(),
    fixtureProducts: filterActiveProducts(fixtureProducts()),
  });
  return resolved;
}

export function useProducts() {
  const [products, setProducts] = useState<ProductRow[]>(() =>
    pdvFixturesEnabled() ? filterActiveProducts(fixtureProducts()) : []
  );
  const [loading, setLoading] = useState(() => !pdvFixturesEnabled());
  const [error, setError] = useState<string | null>(null);
  const [fromCatalog, setFromCatalog] = useState(false);

  const load = useCallback(async () => {
    try {
      const supabase = createClient();
      setLoading(true);
      const { data, error: queryError } = await supabase
        .from("products")
        .select("id, sku, name, unit_price, barcode, category_id, is_active")
        .order("name");

      const resolved = applyCatalogResult(Boolean(queryError) || !data, (data as ProductRow[] | null) ?? null);
      setProducts(resolved.products);
      setFromCatalog(false);
      setError(resolved.error);
    } catch {
      const resolved = applyCatalogResult(true, null);
      setProducts(resolved.products);
      setFromCatalog(false);
      setError(resolved.error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial catalog loading synchronizes this client with Supabase.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return { products, loading, error, reload: load, fromCatalog };
}

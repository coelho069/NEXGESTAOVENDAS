"use client";

import { useCallback, useEffect, useState } from "react";
import { DEMO_PRODUCTS } from "@/lib/domain/catalog";
import { filterActiveProducts, type ProductRow } from "@/lib/domain/product";
import { createClient } from "@/lib/supabase/client";

export function useProducts() {
  const [products, setProducts] = useState<ProductRow[]>(filterActiveProducts(DEMO_PRODUCTS));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromCatalog, setFromCatalog] = useState(true);

  const load = useCallback(async () => {
    try {
      const supabase = createClient();
      setLoading(true);
      const { data, error: queryError } = await supabase
        .from("products")
        .select("id, sku, name, unit_price, barcode, category_id, is_active")
        .order("name");

      if (queryError || !data) {
        setProducts(filterActiveProducts(DEMO_PRODUCTS));
        setFromCatalog(true);
        setError(queryError?.message ?? null);
      } else {
        setProducts(filterActiveProducts(data as ProductRow[]));
        setFromCatalog(false);
        setError(null);
      }
    } catch {
      setProducts(filterActiveProducts(DEMO_PRODUCTS));
      setFromCatalog(true);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { products, loading, error, reload: load, fromCatalog };
}
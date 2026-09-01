"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ProductRow } from "@/lib/domain/product";

export function useProducts() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error: queryError } = await supabase
      .from("products")
      .select("id, sku, name, unit_price, barcode, category_id, is_active")
      .eq("is_active", true)
      .order("name");

    if (queryError) {
      setError(queryError.message);
      setProducts([]);
    } else {
      setProducts((data ?? []) as ProductRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { products, loading, error, reload: load };
}

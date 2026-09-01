"use client";

import { useCallback, useEffect, useState } from "react";
import { DEMO_CUSTOMERS, type CatalogCustomer } from "@/lib/domain/catalog";
import { createClient } from "@/lib/supabase/client";

export function useCustomers() {
  const [customers, setCustomers] = useState<CatalogCustomer[]>(DEMO_CUSTOMERS);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error: queryError } = await supabase
        .from("customers")
        .select("id, name, document, email")
        .order("name");

      if (queryError || !data) {
        setCustomers(DEMO_CUSTOMERS);
        setError(queryError?.message ?? null);
        return;
      }

      setCustomers(data as CatalogCustomer[]);
      setError(null);
    } catch {
      setCustomers(DEMO_CUSTOMERS);
      setError(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { customers, error, reload: load };
}
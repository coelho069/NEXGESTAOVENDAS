"use client";

import { useCallback, useEffect, useState } from "react";
import { DEMO_CUSTOMERS, type CatalogCustomer } from "@/lib/domain/catalog";
import { pdvFixturesEnabled } from "@/lib/pdv/fixtures";
import { createClient } from "@/lib/supabase/client";

export function useCustomers() {
  const [customers, setCustomers] = useState<CatalogCustomer[]>(() =>
    pdvFixturesEnabled() ? DEMO_CUSTOMERS : []
  );
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error: queryError } = await supabase
        .from("customers")
        .select("id, name, document, email")
        .order("name");

      if (queryError || !data) {
        setCustomers(pdvFixturesEnabled() ? DEMO_CUSTOMERS : []);
        setError(queryError ? "Clientes indisponíveis." : null);
        return;
      }

      setCustomers(data as CatalogCustomer[]);
      setError(null);
    } catch {
      setCustomers(pdvFixturesEnabled() ? DEMO_CUSTOMERS : []);
      setError("Clientes indisponíveis.");
    }
  }, []);

  useEffect(() => {
    // Initial catalog loading synchronizes this client with Supabase.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return { customers, error, reload: load };
}
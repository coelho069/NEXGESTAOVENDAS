"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_STORE_SALE_POLICY,
  parseStoreSalePolicy,
  type StoreSalePolicy,
} from "@/lib/domain/store-sale-policy";

export function useStoreSalePolicy(storeId: string | null): StoreSalePolicy {
  const [policy, setPolicy] = useState<StoreSalePolicy>(DEFAULT_STORE_SALE_POLICY);

  useEffect(() => {
    if (!storeId) {
      setPolicy(DEFAULT_STORE_SALE_POLICY);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/store/settings?store_id=${encodeURIComponent(storeId)}`, {
          credentials: "include",
        });
        if (!response.ok) {
          if (!cancelled) setPolicy(DEFAULT_STORE_SALE_POLICY);
          return;
        }
        const json: unknown = await response.json();
        if (!cancelled) setPolicy(parseStoreSalePolicy(json));
      } catch {
        if (!cancelled) setPolicy(DEFAULT_STORE_SALE_POLICY);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  return policy;
}

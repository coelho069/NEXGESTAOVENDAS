"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_STORE_SALE_POLICY,
  parseStoreSalePolicy,
  type StoreSalePolicy,
} from "@/lib/domain/store-sale-policy";
import { runWhenIdle } from "@/lib/offline/run-when-idle";

export async function fetchStoreSalePolicy(storeId: string): Promise<StoreSalePolicy> {
  try {
    const response = await fetch(`/api/store/settings?store_id=${encodeURIComponent(storeId)}`, {
      credentials: "include",
    });
    if (!response.ok) {
      return DEFAULT_STORE_SALE_POLICY;
    }
    return parseStoreSalePolicy(await response.json());
  } catch {
    return DEFAULT_STORE_SALE_POLICY;
  }
}

export function useStoreSalePolicy(storeId: string | null): StoreSalePolicy {
  const [policy, setPolicy] = useState<StoreSalePolicy>(DEFAULT_STORE_SALE_POLICY);

  useEffect(() => {
    if (!storeId) {
      setPolicy(DEFAULT_STORE_SALE_POLICY);
      return;
    }

    let cancelled = false;
    const load = async () => {
      const next = await fetchStoreSalePolicy(storeId);
      if (!cancelled) setPolicy(next);
    };
    // Após o primeiro paint; até lá vale a política padrão (o servidor continua validando).
    const cancelIdle = runWhenIdle(() => void load());
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [storeId]);

  return policy;
}

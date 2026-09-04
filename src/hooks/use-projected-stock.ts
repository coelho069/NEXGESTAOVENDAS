"use client";

import { useCallback, useEffect, useState } from "react";
import { getPdvLocalDbForUser } from "@/lib/offline/pdv-local-db";
import { pdvFixturesEnabled, writeFixtureInventory } from "@/lib/pdv/fixtures";
import { useSessionStore } from "@/stores/session-store";
import { inventoryQuantityToNumber } from "@/lib/domain/quantity";

export function useProjectedStock(storeId: string | null, epoch = 0) {
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [loadedStoreId, setLoadedStoreId] = useState<string | null>(null);
  const userId = useSessionStore((state) => state.userId);

  const reload = useCallback(async () => {
    if (!storeId) {
      setBalances({});
      setLoadedStoreId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const db = getPdvLocalDbForUser(userId);
      if (pdvFixturesEnabled()) {
        const stock = await writeFixtureInventory(db, storeId);
        setBalances(stock);
        setLoadedStoreId(storeId);
        return;
      }
      const rows = await db.inventoryBalances.where("storeId").equals(storeId).toArray();
      const next: Record<string, number> = {};
      for (const row of rows) {
        next[row.productId] = inventoryQuantityToNumber(row.quantity);
      }
      setBalances(next);
      setLoadedStoreId(storeId);
    } catch {
      setBalances({});
      setLoadedStoreId(storeId);
    } finally {
      setLoading(false);
    }
  }, [storeId, userId]);

  useEffect(() => {
    const handleInventorySync = () => void reload();
    window.addEventListener("pdv:inventory-sync", handleInventorySync);
    void reload();
    return () => window.removeEventListener("pdv:inventory-sync", handleInventorySync);
  }, [reload, epoch]);

  return { balances, loading: Boolean(storeId) && (loading || loadedStoreId !== storeId), reload };
}

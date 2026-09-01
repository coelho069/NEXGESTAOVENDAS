"use client";

import { useCallback, useEffect, useState } from "react";
import { getPdvLocalDb } from "@/lib/offline/pdv-local-db";
import { ensureLocalInventory } from "@/lib/offline/seed-local-inventory";

export function useProjectedStock(storeId: string | null, epoch = 0) {
  const [balances, setBalances] = useState<Record<string, number>>({});

  const reload = useCallback(async () => {
    if (!storeId) {
      setBalances({});
      return;
    }
    try {
      const db = getPdvLocalDb();
      await ensureLocalInventory(db, storeId);
      const rows = await db.inventoryBalances.where("storeId").equals(storeId).toArray();
      const next: Record<string, number> = {};
      for (const row of rows) {
        next[row.productId] = row.quantity;
      }
      setBalances(next);
    } catch {
      setBalances({});
    }
  }, [storeId]);

  useEffect(() => {
    void reload();
  }, [reload, epoch]);

  return { balances, reload };
}
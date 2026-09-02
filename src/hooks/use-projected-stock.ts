"use client";

import { useCallback, useEffect, useState } from "react";
import { getPdvLocalDb } from "@/lib/offline/pdv-local-db";
import { pdvFixturesEnabled, writeFixtureInventory } from "@/lib/pdv/fixtures";

export function useProjectedStock(storeId: string | null, epoch = 0) {
  const [balances, setBalances] = useState<Record<string, number>>({});

  const reload = useCallback(async () => {
    if (!storeId) {
      setBalances({});
      return;
    }
    try {
      const db = getPdvLocalDb();
      if (pdvFixturesEnabled()) {
        const stock = await writeFixtureInventory(db, storeId);
        setBalances(stock);
        return;
      }
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
    // Inventory loading synchronizes this client with IndexedDB.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload, epoch]);

  return { balances, reload };
}

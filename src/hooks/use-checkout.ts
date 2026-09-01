"use client";

import { useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { buildProcessSalePayload } from "@/lib/domain/sale";
import { getPaymentAdapter } from "@/lib/adapters/payment";
import { enqueueMutation, listPendingMutations, removeMutation, updateMutationStatus } from "@/lib/offline/db";
import { useCartStore } from "@/stores/cart-store";
import { useSyncStore } from "@/stores/sync-store";

async function postProcessSale(payload: ReturnType<typeof buildProcessSalePayload>) {
  const response = await fetch("/api/sales/process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = (await response.json()) as { error?: string; sale_id?: string; replay?: boolean };
  if (!response.ok) {
    throw new Error(body.error ?? "Falha ao processar venda");
  }
  return body;
}

export function useCheckout() {
  const { storeId, lines, discount, clear } = useCartStore();
  const { setSyncing, markSynced, setPendingCount } = useSyncStore();

  const checkoutCash = useCallback(async () => {
    if (!storeId) throw new Error("Selecione uma loja");
    if (lines.length === 0) throw new Error("Carrinho vazio");

    const adapter = getPaymentAdapter("cash");
    const total = useCartStore.getState().total();
    adapter.process(total);

    const clientMutationId = uuidv4();
    const payload = buildProcessSalePayload(storeId, clientMutationId, lines, "cash", { discount });

    if (!navigator.onLine) {
      await enqueueMutation({
        id: clientMutationId,
        storeId,
        payload,
        syncStatus: "pending",
        createdAt: new Date().toISOString(),
      });
      const pending = await listPendingMutations();
      setPendingCount(pending.length);
      clear();
      return { offline: true as const, clientMutationId };
    }

    setSyncing(true);
    try {
      const result = await postProcessSale(payload);
      clear();
      markSynced();
      setPendingCount(0);
      return { offline: false as const, ...result };
    } finally {
      setSyncing(false);
    }
  }, [storeId, lines, discount, clear, setSyncing, markSynced, setPendingCount]);

  const flushPending = useCallback(async () => {
    if (!navigator.onLine) return;
    const pending = await listPendingMutations();
    setPendingCount(pending.length);
    if (pending.length === 0) return;

    setSyncing(true);
    try {
      for (const mutation of pending) {
        await updateMutationStatus(mutation.id, "processing");
        try {
          await postProcessSale(mutation.payload);
          await removeMutation(mutation.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : "sync failed";
          await updateMutationStatus(mutation.id, "failed", message);
        }
      }
      const remaining = await listPendingMutations();
      setPendingCount(remaining.length);
      if (remaining.length === 0) markSynced();
    } finally {
      setSyncing(false);
    }
  }, [markSynced, setPendingCount, setSyncing]);

  return { checkoutCash, flushPending };
}

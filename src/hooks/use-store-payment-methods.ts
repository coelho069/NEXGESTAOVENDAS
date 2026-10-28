"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_ACCEPTED_PAYMENT_METHODS,
  normalizeAcceptedPaymentMethods,
  type ManualPaymentMethod,
} from "@/lib/domain/store-payment-methods";
import { runWhenIdle } from "@/lib/offline/run-when-idle";

export type SaveAcceptedPaymentMethodsResult = { ok: true } | { ok: false; error: string };

export function useStorePaymentMethods(storeId: string | null): {
  accepted: ManualPaymentMethod[];
  save: (methods: ManualPaymentMethod[]) => Promise<SaveAcceptedPaymentMethodsResult>;
} {
  const [accepted, setAccepted] = useState<ManualPaymentMethod[]>([...DEFAULT_ACCEPTED_PAYMENT_METHODS]);

  useEffect(() => {
    setAccepted([...DEFAULT_ACCEPTED_PAYMENT_METHODS]);
    if (!storeId) return;
    let cancelled = false;
    // Após o primeiro paint: o padrão já está na tela; a leitura da loja só ajusta as opções.
    const cancelIdle = runWhenIdle(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/store/settings?store_id=${encodeURIComponent(storeId)}`, {
            credentials: "include",
          });
          if (!response.ok) return;
          const body = (await response.json()) as { accepted_payment_methods?: unknown };
          if (!cancelled) setAccepted(normalizeAcceptedPaymentMethods(body.accepted_payment_methods));
        } catch {
          // Falha de leitura mantém o padrão (todas marcadas).
        }
      })();
    });
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [storeId]);

  const save = useCallback(
    async (methods: ManualPaymentMethod[]): Promise<SaveAcceptedPaymentMethodsResult> => {
      if (!storeId) return { ok: false, error: "forbidden_store" };
      if (methods.length === 0) return { ok: false, error: "invalid_settings_payment_methods" };
      try {
        const response = await fetch("/api/store/settings/payment-methods", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ store_id: storeId, accepted_payment_methods: methods }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          accepted_payment_methods?: unknown;
          error?: string;
        };
        if (!response.ok) return { ok: false, error: body.error ?? "unavailable" };
        setAccepted(normalizeAcceptedPaymentMethods(body.accepted_payment_methods ?? methods));
        return { ok: true };
      } catch {
        return { ok: false, error: "unavailable" };
      }
    },
    [storeId]
  );

  return { accepted, save };
}

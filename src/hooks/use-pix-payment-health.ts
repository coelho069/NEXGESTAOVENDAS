"use client";

import { useEffect, useState } from "react";
import { fetchPixPaymentSelectable } from "@/lib/adapters/payment-health";

export function usePixPaymentHealth(): boolean {
  const [pixSelectable, setPixSelectable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchPixPaymentSelectable().then((selectable) => {
      if (!cancelled) {
        setPixSelectable(selectable);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return pixSelectable;
}

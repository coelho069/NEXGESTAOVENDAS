"use client";

import { useEffect, useState } from "react";
import { fetchCardPaymentSelectable } from "@/lib/adapters/payment-health";

export function useCardPaymentHealth(): boolean {
  const [cardSelectable, setCardSelectable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchCardPaymentSelectable().then((selectable) => {
      if (!cancelled) {
        setCardSelectable(selectable);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return cardSelectable;
}

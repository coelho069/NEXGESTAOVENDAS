"use client";

import { useEffect, useRef } from "react";
import { HidScanAssembler } from "@/lib/domain/hid-scanner";

export function useHidScanner(onScan: (code: string) => void, enabled = true): void {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    const assembler = new HidScanAssembler();

    const handler = (event: KeyboardEvent) => {
      if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      const result = assembler.push(event.key, performance.now());
      if (result.type === "scan") {
        event.preventDefault();
        event.stopPropagation();
        onScanRef.current(result.code);
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [enabled]);
}
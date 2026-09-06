"use client";

import { useEffect, useRef } from "react";
import { HidScanAssembler } from "@/lib/domain/hid-scanner";
import { shouldAcceptHidScan } from "@/lib/domain/pdv-shortcuts";

function playScanBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.04;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.06);
    window.setTimeout(() => {
      void ctx.close();
    }, 120);
  } catch {
    // Audio is best-effort; scanners must still work without sound.
  }
}

export function useHidScanner(
  onScan: (code: string) => void,
  enabled = true,
  modalOpen = false,
  beepOnScan = true
): void {
  const onScanRef = useRef(onScan);
  const modalOpenRef = useRef(modalOpen);
  const beepRef = useRef(beepOnScan);

  useEffect(() => {
    onScanRef.current = onScan;
    modalOpenRef.current = modalOpen;
    beepRef.current = beepOnScan;
  }, [onScan, modalOpen, beepOnScan]);

  useEffect(() => {
    if (!enabled) return;
    const assembler = new HidScanAssembler();

    const handler = (event: KeyboardEvent) => {
      if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (!shouldAcceptHidScan(event.target, modalOpenRef.current)) {
        assembler.reset();
        return;
      }
      const result = assembler.push(event.key, performance.now());
      if (result.type === "scan") {
        event.preventDefault();
        event.stopPropagation();
        if (beepRef.current) playScanBeep();
        onScanRef.current(result.code);
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [enabled]);
}
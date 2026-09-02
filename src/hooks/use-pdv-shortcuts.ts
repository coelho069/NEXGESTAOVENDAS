"use client";

import { useEffect, useRef } from "react";
import { matchPdvShortcut, shouldHandleShortcut, type PdvShortcut } from "@/lib/domain/pdv-shortcuts";

export type PdvShortcutHandlers = Partial<Record<PdvShortcut, () => void>>;

export function usePdvShortcuts(handlers: PdvShortcutHandlers, modalOpen = false): void {
  const handlersRef = useRef(handlers);
  const modalOpenRef = useRef(modalOpen);

  useEffect(() => {
    handlersRef.current = handlers;
    modalOpenRef.current = modalOpen;
  }, [handlers, modalOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = matchPdvShortcut(event);
      if (!shortcut) return;
      if (!shouldHandleShortcut(shortcut, event.target, modalOpenRef.current)) return;
      const handler = handlersRef.current[shortcut];
      if (!handler) return;
      event.preventDefault();
      handler();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
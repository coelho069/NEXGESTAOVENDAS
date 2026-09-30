export const ANNE_SUPPORT_OPEN_EVENT = "nex:anne-support-open";

/** Opens the floating Anne Suporte chat (no-op if the widget is not mounted). */
export function openAnneSupport(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ANNE_SUPPORT_OPEN_EVENT));
}

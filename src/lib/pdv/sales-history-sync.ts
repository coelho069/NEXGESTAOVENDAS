export const SALES_HISTORY_SYNC_EVENT = "pdv:sales-history-sync" as const;

export function notifySalesHistorySync(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SALES_HISTORY_SYNC_EVENT));
}

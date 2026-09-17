import { describe, expect, it, vi } from "vitest";
import {
  SALES_HISTORY_SYNC_EVENT,
  notifySalesHistorySync,
} from "@/lib/pdv/sales-history-sync";

describe("sales-history-sync", () => {
  it("dispatches pdv:sales-history-sync on notify", () => {
    const handler = vi.fn();
    window.addEventListener(SALES_HISTORY_SYNC_EVENT, handler);
    notifySalesHistorySync();
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(SALES_HISTORY_SYNC_EVENT, handler);
  });
});

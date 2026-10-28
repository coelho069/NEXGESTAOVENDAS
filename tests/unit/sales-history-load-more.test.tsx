import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SaleHistoryListItem } from "@/lib/domain/sale-history";
import { useSalesHistory } from "@/hooks/use-sales-history";

const STORE = "22222222-2222-4222-8222-222222222201";
const CURSOR = { after_created_at: "2026-10-07T12:00:00.000Z", after_id: "sale-a" };

function row(id: string): SaleHistoryListItem {
  return {
    sale_id: id,
    status: "confirmed",
    sync_status: "synced",
    total: "10.00",
    discount: "0.00",
    subtotal: "10.00",
    customer_name: null,
    cashier_id: null,
    operator_name: null,
    payment_method: "cash",
    payment_status: "captured",
    created_at: "2026-10-07T12:00:00.000Z",
    confirmed_at: "2026-10-07T12:00:00.000Z",
  };
}

function page(ids: string[], hasMore: boolean) {
  return new Response(
    JSON.stringify({
      rows: ids.map(row),
      next_cursor: hasMore ? CURSOR : null,
      has_more: hasMore,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("sales history load more", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("appends one page when load more is requested twice and ignores a page overtaken by refresh", async () => {
    const pending: Array<(response: Response) => void> = [];
    const urls: string[] = [];
    vi.stubEnv("NEXT_PUBLIC_PDV_FIXTURES", "");
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      return new Promise<Response>((resolve) => {
        pending.push(resolve);
      });
    });

    const { result } = renderHook(() => useSalesHistory(STORE));
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => {
      pending[0]?.(page(["sale-a"], true));
    });
    await waitFor(() => expect(result.current.rows.map((item) => item.sale_id)).toEqual(["sale-a"]));

    let more: Promise<unknown> = Promise.resolve();
    let refreshed: Promise<unknown> = Promise.resolve();
    await act(async () => {
      more = result.current.loadMore();
      void result.current.loadMore();
      refreshed = result.current.refresh();
    });
    await waitFor(() => expect(pending.length).toBeGreaterThanOrEqual(3));

    const moreRequests = urls.filter((url) => url.includes("after_id="));
    expect(moreRequests).toHaveLength(1);

    await act(async () => {
      const refreshResponse = pending[pending.length - 1];
      refreshResponse?.(page(["sale-a"], true));
      await refreshed;
      pending[1]?.(page(["sale-b", "sale-b"], false));
      await more;
    });

    expect(result.current.rows.map((item) => item.sale_id)).toEqual(["sale-a"]);
  });

  it("keeps one row when the next page repeats a sale already on the list", async () => {
    const pending: Array<(response: Response) => void> = [];
    vi.stubEnv("NEXT_PUBLIC_PDV_FIXTURES", "");
    vi.stubGlobal("fetch", () => {
      return new Promise<Response>((resolve) => {
        pending.push(resolve);
      });
    });

    const { result } = renderHook(() => useSalesHistory(STORE));
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => {
      pending[0]?.(page(["sale-a", "sale-a"], true));
    });
    await waitFor(() => expect(result.current.rows.map((item) => item.sale_id)).toEqual(["sale-a"]));

    let more: Promise<unknown> = Promise.resolve();
    await act(async () => {
      more = result.current.loadMore();
    });
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => {
      pending[1]?.(page(["sale-a", "sale-b", "sale-b"], false));
      await more;
    });

    expect(result.current.rows.map((item) => item.sale_id)).toEqual(["sale-a", "sale-b"]);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  HttpFiscalAdapter,
  NotConfiguredFiscalAdapter,
  type FiscalOperationContext,
} from "@/lib/adapters/fiscal";
import {
  assertFiscalTransition,
  canTransitionFiscal,
} from "@/lib/domain/fiscal-state";

const context: FiscalOperationContext = {
  documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  saleId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  storeId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  operationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  idempotencyKey: "fiscal:document:issue:operation",
  snapshot: {
    sale: { total: 10 },
    items: [{ sku: "SKU-1", unit_price: "10.00" }],
  },
};

describe("fiscal adapter contract", () => {
  it("returns NOT_CONFIGURED for every operation without a provider", async () => {
    const adapter = new NotConfiguredFiscalAdapter();

    for (const result of [
      adapter.issue(context),
      adapter.cancel(context),
      adapter.consult(context),
    ]) {
      expect(await result).toMatchObject({
        status: "not_configured",
        errorCode: "provider_not_configured",
      });
    }
  });

  it("does not infer ISSUED from a response without an explicit provider state", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const adapter = new HttpFiscalAdapter("test", "https://provider.invalid/api", "secret", {
      fetchFn,
    });

    await expect(adapter.issue(context)).resolves.toMatchObject({
      status: "unknown",
      errorCode: "provider_status_missing",
    });
  });

  it("maps timeout/transport uncertainty to UNKNOWN", async () => {
    const fetchFn = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          void _input;
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true }
          );
        })
    );
    const adapter = new HttpFiscalAdapter("test", "https://provider.invalid/api", "secret", {
      fetchFn,
      timeoutMs: 1_000,
    });

    await expect(adapter.issue(context)).resolves.toMatchObject({
      status: "unknown",
      errorCode: "provider_timeout",
    });
  });

  it("reuses the supplied idempotency key and never includes the API key in the payload", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ status: "issued", external_id: "NFC-1" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });
    const adapter = new HttpFiscalAdapter("test", "https://provider.invalid/api", "secret", {
      fetchFn,
    });

    await adapter.issue(context);
    await adapter.issue(context);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    for (const call of fetchFn.mock.calls) {
      const init = call[1] as RequestInit;
      expect(new Headers(init.headers).get("X-Idempotency-Key")).toBe(context.idempotencyKey);
      expect(String(init.body)).not.toContain("secret");
    }
  });
});

describe("fiscal state machine", () => {
  it("requires a new pending operation after failed/cancelled", () => {
    expect(canTransitionFiscal("failed", "issued")).toBe(false);
    expect(canTransitionFiscal("cancelled", "issued")).toBe(false);
    expect(canTransitionFiscal("failed", "pending")).toBe(true);
    expect(canTransitionFiscal("unknown", "issued")).toBe(true);
    expect(() => assertFiscalTransition("failed", "issued")).toThrow(
      "Invalid fiscal status transition"
    );
  });
});

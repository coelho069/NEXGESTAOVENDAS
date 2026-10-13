import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeLiveMercadoPagoRefund } from "@/lib/server/mercadopago-refund-live";

const KEY = "mercadopago:refund:00000000-0000-4000-8000-000000000001";

function longPayment(status: string, refunds: unknown[] = []) {
  // Resposta realista do MP: bem maior que 4.000 caracteres.
  return {
    id: 100000000001,
    status,
    status_detail: status === "refunded" ? "refunded" : "accredited",
    transaction_amount: 5,
    refunds,
    additional_info: { items: Array.from({ length: 40 }, (_, i) => ({ id: `item-${i}`, title: "x".repeat(120) })) },
    fee_details: [{ type: "mercadopago_fee", amount: 0.5 }],
  };
}

function json(body: unknown, status = 200) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

describe("executeLiveMercadoPagoRefund parsing", () => {
  beforeEach(() => {
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "TEST-0000-unit");
    vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "unit-webhook");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads a long approved payment (>4000 chars) and posts one refund with the fixed key", async () => {
    const payment = longPayment("approved");
    expect(JSON.stringify(payment).length).toBeGreaterThan(4000);
    const calls: Array<{ url: string; method: string; key: string | null }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      calls.push({ url: String(url), method, key: headers.get("X-Idempotency-Key") });
      if (method === "POST") return json({ id: 900000001, status: "approved" }, 201);
      if (String(url).endsWith("/refunds")) return json([]);
      return json(payment);
    }) as unknown as typeof fetch;
    const result = await executeLiveMercadoPagoRefund({ mpPaymentId: "100000000001", idempotencyKey: KEY, fetchImpl });
    expect(result).toEqual({ ok: true, refundId: "900000001", status: "approved", alreadyRefunded: false });
    expect(calls.filter((c) => c.method === "POST")).toEqual([
      { url: "https://api.mercadopago.com/v1/payments/100000000001/refunds", method: "POST", key: KEY },
    ]);
  });

  it("records an already refunded long payment without posting", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") throw new Error("must not post");
      if (String(url).endsWith("/refunds")) return json([{ id: 900000002, status: "approved" }]);
      return json(longPayment("refunded", [{ id: 900000002, status: "approved" }]));
    }) as unknown as typeof fetch;
    const result = await executeLiveMercadoPagoRefund({ mpPaymentId: "100000000001", idempotencyKey: KEY, fetchImpl });
    expect(result).toEqual({ ok: true, refundId: "900000002", status: "approved", alreadyRefunded: true });
  });

  it("returns mp_invalid_response on unparseable body, never 'not approved'", async () => {
    const fetchImpl = vi.fn(async () => json("<html>gateway</html>")) as unknown as typeof fetch;
    const result = await executeLiveMercadoPagoRefund({ mpPaymentId: "100000000001", idempotencyKey: KEY, fetchImpl });
    expect(result).toEqual({ ok: false, error: "mp_invalid_response" });
  });

  it("still refuses a payment that is not approved", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/refunds") ? json([]) : json(longPayment("pending"))
    ) as unknown as typeof fetch;
    const result = await executeLiveMercadoPagoRefund({ mpPaymentId: "100000000001", idempotencyKey: KEY, fetchImpl });
    expect(result).toEqual({ ok: false, error: "mp_payment_not_refundable" });
  });
});

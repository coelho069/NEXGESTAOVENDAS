import { describe, expect, it, beforeEach } from "vitest";
import { isMutatingMethod, isSameOriginRequest } from "@/lib/security/request";
import {
  fiscalIssueInputSchema,
  inventoryImportSchema,
  productWriteSchema,
  reconcilePaymentInputSchema,
} from "@/lib/validation/schemas";
import { canManageFiscal, canViewReports } from "@/lib/domain/rbac";
import { renderReceiptHtml, type ReceiptModel } from "@/lib/domain/receipt";
import { stripSecrets } from "@/lib/offline/secrets";
import {
  clientRateLimitKey,
  consumeRateLimit,
  resetRateLimitStateForTests,
} from "@/lib/security/rate-limit";
import { validationFailedResponse } from "@/lib/security/safe-error";
import { getFiscalProviderConfig } from "@/lib/server/fiscal-provider";

function request(
  url: string,
  headers: Record<string, string> = {}
): Pick<Request, "url" | "headers"> {
  return { url, headers: new Headers(headers) };
}

describe("production security boundaries", () => {
  beforeEach(() => {
    resetRateLimitStateForTests();
    delete process.env.APP_ORIGIN;
  });

  it("classifies only state-changing HTTP methods as mutating", () => {
    expect(isMutatingMethod("POST")).toBe(true);
    expect(isMutatingMethod("patch")).toBe(true);
    expect(isMutatingMethod("GET")).toBe(false);
    expect(isMutatingMethod("OPTIONS")).toBe(false);
  });

  it("accepts same-origin browser requests and rejects cross-site origins", () => {
    expect(
      isSameOriginRequest(
        request("https://app.example.test/api/sales", {
          origin: "https://app.example.test",
          "sec-fetch-site": "same-origin",
        })
      )
    ).toBe(true);
    expect(
      isSameOriginRequest(
        request("https://app.example.test/api/sales", {
          origin: "https://evil.example.test",
          "sec-fetch-site": "cross-site",
        })
      )
    ).toBe(false);
  });

  it("rejects opaque/null origins and cross-site fetch metadata", () => {
    expect(
      isSameOriginRequest(
        request("https://app.example.test/api/sales", { origin: "null" })
      )
    ).toBe(false);
    expect(
      isSameOriginRequest(
        request("https://app.example.test/api/sales", {
          "sec-fetch-site": "cross-site",
        })
      )
    ).toBe(false);
  });

  it("strips authorization fields from catalog input and bounds imports", () => {
    const product = productWriteSchema.parse({
      store_id: "22222222-2222-4222-8222-222222222201",
      sku: "SEC-001",
      name: "Produto de teste",
      unit_price: "10.00",
      cost_price: "5.00",
      role: "admin",
      organization_id: "11111111-1111-4111-8111-111111111111",
    });

    expect(product).not.toHaveProperty("role");
    expect(product).not.toHaveProperty("organization_id");
    expect(
      inventoryImportSchema.safeParse({
        store_id: "22222222-2222-4222-8222-222222222201",
        import_id: "33333333-3333-4333-8333-333333333333",
        csv: "x".repeat(1_000_001),
      }).success
    ).toBe(false);
  });

  it("rejects payment and fiscal status tampering via request schemas", () => {
    const payment = reconcilePaymentInputSchema.parse({
      store_id: "22222222-2222-4222-8222-222222222201",
      payment_id: "55555555-5555-4555-8555-555555555555",
      status: "captured",
    });
    expect(payment).not.toHaveProperty("status");

    const fiscal = fiscalIssueInputSchema.parse({
      store_id: "22222222-2222-4222-8222-222222222201",
      sale_id: "66666666-6666-4666-8666-666666666666",
      status: "issued",
    });
    expect(fiscal).not.toHaveProperty("status");
  });

  it("keeps fiscal cancel as a manager/admin capability", () => {
    expect(canManageFiscal("cashier")).toBe(false);
    expect(canManageFiscal("manager")).toBe(true);
    expect(canViewReports("cashier")).toBe(false);
  });

  it("escapes untrusted receipt fields for HTML rendering", () => {
    const model: ReceiptModel = {
      saleId: "sale-1",
      storeName: '<img src=x onerror="alert(1)">',
      createdAt: "2026-09-04T12:00:00.000Z",
      customerName: "<script>alert(1)</script>",
      lines: [
        {
          productId: "p1",
          sku: "SKU<script>",
          name: "Produto & Cia",
          quantity: 1,
          unitPrice: "10.00",
          discount: "0.00",
        },
      ],
      subtotal: "10.00",
      discount: "0.00",
      total: "10.00",
      payments: [{ method: "cash", amount: "10.00", status: "captured" }],
      syncStatus: "synced",
      saleStatus: "confirmed",
      fiscalStatus: "pending",
    };

    const html = renderReceiptHtml(model);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("strips secrets from payloads before exposure", () => {
    expect(
      stripSecrets({
        status: "pending",
        api_key: "secret",
        nested: { access_token: "tok", ok: true },
      })
    ).toEqual({ status: "pending", nested: { ok: true } });
  });

  it("rate-limits repeated sensitive calls in-process", () => {
    const first = consumeRateLimit({ key: "test", limit: 2, windowMs: 60_000 });
    const second = consumeRateLimit({ key: "test", limit: 2, windowMs: 60_000 });
    const third = consumeRateLimit({ key: "test", limit: 2, windowMs: 60_000 });
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
  });

  it("prefers authenticated subjects and ignores spoofable forwarded IPs by default", () => {
    const req = new Request("https://app.example.test/api/x", {
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    expect(clientRateLimitKey(req, "scope", "user-1")).toBe("scope:sub:user-1");
    expect(clientRateLimitKey(req, "scope")).toBe("scope:untrusted");
  });

  it("hides validation details in production error responses", async () => {
    const response = validationFailedResponse(true, { fieldErrors: { a: ["x"] } });
    await expect(response.json()).resolves.toEqual({ error: "Validation failed" });
  });

  it("keeps unconfigured fiscal provider as not_configured", () => {
    const previous = {
      provider: process.env.FISCAL_PROVIDER,
      url: process.env.FISCAL_PROVIDER_URL,
      key: process.env.FISCAL_PROVIDER_API_KEY,
    };
    delete process.env.FISCAL_PROVIDER;
    delete process.env.FISCAL_PROVIDER_URL;
    delete process.env.FISCAL_PROVIDER_API_KEY;

    expect(getFiscalProviderConfig().configured).toBe(false);
    expect(getFiscalProviderConfig().provider).toBe("not_configured");

    process.env.FISCAL_PROVIDER = previous.provider;
    process.env.FISCAL_PROVIDER_URL = previous.url;
    process.env.FISCAL_PROVIDER_API_KEY = previous.key;
  });
});

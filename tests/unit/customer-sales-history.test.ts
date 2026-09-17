import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthedContext } from "@/lib/auth/session";
import {
  parseCustomerSalesResponse,
  parseCustomerSalesSummary,
} from "@/lib/domain/customer-sales";

const { getAuthedContext, createClient } = vi.hoisted(() => ({
  getAuthedContext: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getAuthedContext }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

import { GET } from "@/app/api/customers/[id]/sales/route";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20260917130000_customer_sales_history.sql"),
  "utf8"
);

const ORG_A = "11111111-1111-4111-8111-111111111111";
const STORE_A = "22222222-2222-4222-8222-222222222201";
const CUSTOMER_ID = "55555555-5555-4555-8555-555555555599";
const SALE_CONFIRMED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SALE_PENDING = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

function cashierContext(): AuthedContext {
  return {
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    role: "cashier",
    orgId: ORG_A,
    storeId: STORE_A,
    storeName: "Loja",
    stores: [{ id: STORE_A, name: "Loja", orgId: ORG_A, role: "cashier" }],
  };
}

function request(customerId: string, query = ""): Request {
  return new Request(`http://localhost/api/customers/${customerId}/sales${query}`, {
    method: "GET",
  });
}

describe("customer sales migration (Payment Guardian)", () => {
  it("indexes customer sales and exposes list_customer_sales RPC with org scoping", () => {
    expect(MIGRATION).toContain("CREATE INDEX IF NOT EXISTS sales_customer_created_idx");
    expect(MIGRATION).toContain("CREATE OR REPLACE FUNCTION public.list_customer_sales(p_payload jsonb)");
    expect(MIGRATION).toContain("AND c.org_id = v_org_id");
    expect(MIGRATION).toContain("public.user_has_store_access(s.store_id)");
    expect(MIGRATION).toContain("GRANT EXECUTE ON FUNCTION public.list_customer_sales(jsonb) TO authenticated");
  });

  it("aggregates lifetime revenue only from confirmed sales with captured payment", () => {
    expect(MIGRATION).toContain("AND s.status = 'confirmed'");
    expect(MIGRATION).toContain("AND p.status = 'captured'");
    expect(MIGRATION).toContain("AND p.amount = s.total");
    expect(MIGRATION).not.toContain("partially_refunded");
    expect(MIGRATION).not.toContain("sale_returns");
  });

  it("lists all accessible sales for visibility without revenue status filter", () => {
    const listSection = MIGRATION.split("st.name AS store_name")[1]?.split("LIMIT v_limit + 1")[0] ?? "";
    expect(listSection).toContain("WHERE s.customer_id = v_customer_id");
    expect(listSection).not.toContain("s.status = 'confirmed'");
  });
});

describe("parseCustomerSalesResponse", () => {
  it("parses summary and rows with org-scoped money strings", () => {
    const payload = parseCustomerSalesResponse({
      summary: {
        lifetime_revenue: "150.00",
        sales_count: 2,
        last_sale_at: "2026-09-17T12:00:00.000Z",
      },
      rows: [
        {
          sale_id: SALE_CONFIRMED,
          store_id: STORE_A,
          store_name: "Loja",
          status: "confirmed",
          sync_status: "synced",
          total: "100.00",
          discount: "0.00",
          subtotal: "100.00",
          customer_name: "Ana",
          cashier_id: null,
          operator_name: null,
          payment_method: "cash",
          payment_status: "captured",
          created_at: "2026-09-17T12:00:00.000Z",
          confirmed_at: "2026-09-17T12:00:00.000Z",
        },
        {
          sale_id: SALE_PENDING,
          store_id: STORE_A,
          store_name: "Loja",
          status: "pending_sync",
          sync_status: "pending",
          total: "50.00",
          discount: "0.00",
          subtotal: "50.00",
          customer_name: "Ana",
          cashier_id: null,
          operator_name: null,
          payment_method: "cash",
          payment_status: "pending",
          created_at: "2026-09-16T12:00:00.000Z",
          confirmed_at: null,
        },
      ],
      has_more: false,
      next_cursor: null,
    });

    expect(payload?.summary).toEqual({
      lifetime_revenue: "150.00",
      sales_count: 2,
      last_sale_at: "2026-09-17T12:00:00.000Z",
    });
    expect(payload?.rows).toHaveLength(2);
    expect(parseCustomerSalesSummary({ lifetime_revenue: "0.00", sales_count: 0, last_sale_at: null })).toEqual({
      lifetime_revenue: "0.00",
      sales_count: 0,
      last_sale_at: null,
    });
  });
});

describe("GET /api/customers/[id]/sales", () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getAuthedContext.mockResolvedValue(cashierContext());
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      rpc,
    });
  });

  it("scopes aggregation RPC by org customer_id", async () => {
    rpc.mockResolvedValue({
      data: {
        summary: {
          lifetime_revenue: "100.00",
          sales_count: 1,
          last_sale_at: "2026-09-17T12:00:00.000Z",
        },
        rows: [],
        has_more: false,
        next_cursor: null,
      },
      error: null,
    });

    const response = await GET(request(CUSTOMER_ID), {
      params: Promise.resolve({ id: CUSTOMER_ID }),
    });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("list_customer_sales", {
      p_payload: {
        customer_id: CUSTOMER_ID,
        limit: 20,
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      summary: { lifetime_revenue: "100.00", sales_count: 1 },
    });
  });

  it("returns 404 when customer is outside org", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "customer_not_found", code: "P0002" },
    });

    const response = await GET(request(CUSTOMER_ID), {
      params: Promise.resolve({ id: CUSTOMER_ID }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "customer_not_found" });
  });

  it("rejects invalid customer id", async () => {
    const response = await GET(request("not-a-uuid"), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("forbids users without org customer access", async () => {
    getAuthedContext.mockResolvedValue(null);

    const response = await GET(request(CUSTOMER_ID), {
      params: Promise.resolve({ id: CUSTOMER_ID }),
    });

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});

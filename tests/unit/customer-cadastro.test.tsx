import { readFileSync } from "node:fs";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CustomerDialog } from "@/components/pdv/customer-dialog";
import { AppNav } from "@/components/layout/app-nav";
import { DEMO_CUSTOMERS } from "@/lib/domain/catalog";
import {
  canWriteCustomers,
  filterCustomers,
  parseCatalogCustomer,
  upsertCustomer,
} from "@/lib/domain/customer";
import { customerWriteSchema } from "@/lib/validation/schemas";
import type { AuthedContext } from "@/lib/auth/session";

const { getAuthedContext, createClient } = vi.hoisted(() => ({
  getAuthedContext: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getAuthedContext }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

import { POST } from "@/app/api/customers/route";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const STORE_A = "22222222-2222-4222-8222-222222222201";
const CUSTOMER_ID = "55555555-5555-4555-8555-555555555599";

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

describe("customer domain", () => {
  it("filters by name and document and keeps walk-in independent", () => {
    const filtered = filterCustomers(DEMO_CUSTOMERS, "TEST-ONLY");
    expect(filtered).toEqual([DEMO_CUSTOMERS[1]]);
    expect(filterCustomers(DEMO_CUSTOMERS, "maria")).toEqual([DEMO_CUSTOMERS[1]]);
    expect(filterCustomers(DEMO_CUSTOMERS, "")).toHaveLength(2);
  });

  it("upserts a created customer into the catalog list", () => {
    const created = {
      id: CUSTOMER_ID,
      name: "Ana Nova",
      document: null,
      email: null,
    };
    const next = upsertCustomer(DEMO_CUSTOMERS, created);
    expect(next.some((customer) => customer.id === CUSTOMER_ID)).toBe(true);
    expect(next[0]?.name).toBe("Ana Nova");
  });

  it("parses catalog rows and ignores extra fields", () => {
    expect(
      parseCatalogCustomer({
        id: CUSTOMER_ID,
        name: "Ana",
        document: "123",
        email: "ana@example.invalid",
        org_id: "should-not-leak",
      })
    ).toEqual({
      id: CUSTOMER_ID,
      name: "Ana",
      document: "123",
      email: "ana@example.invalid",
    });
  });

  it("allows org members to write customers and rejects empty org", () => {
    expect(canWriteCustomers({ orgId: ORG_A, stores: [{}] })).toBe(true);
    expect(canWriteCustomers({ orgId: ORG_A, stores: [] })).toBe(false);
    expect(canWriteCustomers(null)).toBe(false);
  });
});

describe("customerWriteSchema", () => {
  it("requires name and treats document/email as optional blanks", () => {
    expect(customerWriteSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(customerWriteSchema.parse({ name: " Ana ", document: "", email: "" })).toEqual({
      name: "Ana",
      document: null,
      email: null,
    });
    expect(customerWriteSchema.safeParse({ name: "Ana", email: "not-an-email" }).success).toBe(false);
  });
});

describe("CustomerDialog create + select", () => {
  afterEach(() => {
    cleanup();
  });

  it("creates a customer and associates it on the sale", async () => {
    const onSelect = vi.fn();
    const created = { id: CUSTOMER_ID, name: "Ana Nova", document: "123", email: null };
    const onCreate = vi.fn().mockResolvedValue({ ok: true, customer: created });

    render(
      <CustomerDialog
        open
        customers={DEMO_CUSTOMERS}
        selectedId={null}
        onSelect={onSelect}
        onCreate={onCreate}
        onClose={() => undefined}
      />
    );

    fireEvent.change(screen.getByTestId("customer-search"), { target: { value: "Maria" } });
    expect(screen.getByTestId(`customer-${DEMO_CUSTOMERS[1]!.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`customer-${DEMO_CUSTOMERS[0]!.id}`)).not.toBeInTheDocument();
    expect(screen.getByTestId("customer-walk-in")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("customer-new"));
    fireEvent.change(screen.getByTestId("customer-name"), { target: { value: "Ana Nova" } });
    fireEvent.change(screen.getByTestId("customer-document"), { target: { value: "123" } });
    fireEvent.click(screen.getByTestId("customer-save"));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith({
        name: "Ana Nova",
        document: "123",
        email: "",
      });
      expect(onSelect).toHaveBeenCalledWith(created);
    });
  });

  it("keeps walk-in when requireCustomer is false and hides it when true", () => {
    const { rerender } = render(
      <CustomerDialog
        open
        customers={DEMO_CUSTOMERS}
        selectedId={null}
        requireCustomer={false}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onClose={() => undefined}
      />
    );
    expect(screen.getByTestId("customer-walk-in")).toBeInTheDocument();

    rerender(
      <CustomerDialog
        open
        customers={DEMO_CUSTOMERS}
        selectedId={null}
        requireCustomer
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onClose={() => undefined}
      />
    );
    expect(screen.queryByTestId("customer-walk-in")).not.toBeInTheDocument();
  });
});

describe("app-nav clientes link", () => {
  it("exposes the clientes route", () => {
    render(<AppNav role="cashier" storeId={STORE_A} />);
    expect(screen.getByRole("link", { name: "Clientes" })).toHaveAttribute(
      "href",
      `/clientes?store=${STORE_A}`
    );
  });
});

describe("POST /api/customers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthedContext.mockResolvedValue(cashierContext());
  });

  it("inserts with the authenticated org_id and ignores a client org_id", async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: CUSTOMER_ID, name: "Ana Nova", document: null, email: null },
      error: null,
    });
    const insert = vi.fn(() => ({
      select: vi.fn(() => ({ single })),
    }));
    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: cashierContext().userId } } }),
      },
      from: vi.fn(() => ({ insert })),
    });

    const response = await POST(
      new Request("http://localhost/api/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Ana Nova",
          org_id: "99999999-9999-4999-8999-999999999999",
        }),
      })
    );

    expect(response.status).toBe(201);
    expect(insert).toHaveBeenCalledWith({
      org_id: ORG_A,
      name: "Ana Nova",
      document: null,
      email: null,
    });
    await expect(response.json()).resolves.toEqual({
      id: CUSTOMER_ID,
      name: "Ana Nova",
      document: null,
      email: null,
    });
  });

  it("returns 403 when the user has no org membership", async () => {
    getAuthedContext.mockResolvedValue({
      ...cashierContext(),
      orgId: null,
      stores: [],
    });
    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: cashierContext().userId } } }),
      },
      from: vi.fn(),
    });

    const response = await POST(
      new Request("http://localhost/api/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Ana Nova" }),
      })
    );

    expect(response.status).toBe(403);
  });
});

describe("customers write migration", () => {
  it("restores org-scoped insert/update without delete", () => {
    const sql = readFileSync("supabase/migrations/20260917120000_customers_org_write.sql", "utf8");
    expect(sql).toContain("GRANT INSERT, UPDATE ON TABLE public.customers TO authenticated");
    expect(sql).toContain("CREATE POLICY customers_insert ON public.customers");
    expect(sql).toContain("CREATE POLICY customers_update ON public.customers");
    expect(sql).toContain("org_id = public.current_user_org_id()");
    expect(sql).not.toMatch(/\bGRANT DELETE\b|\bFOR DELETE\b/);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canManageCustomers } from "@/lib/domain/rbac";
import {
  filterCustomersLocal,
  normalizeCustomerDocument,
  validateCustomerFields,
} from "@/lib/domain/customer";
import {
  customerDetailQuerySchema,
  customerSearchQuerySchema,
  customerWriteSchema,
} from "@/lib/validation/schemas";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20260905200000_b19_customers_lifecycle.sql"),
  "utf8"
);
const HARDENING_MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20260905203000_b19_customer_query_hardening.sql"),
  "utf8"
);

describe("B19 customer domain validation", () => {
  it("requires a valid name and normalizes optional fields", () => {
    expect(validateCustomerFields({ name: "A" }).ok).toBe(false);
    const ok = validateCustomerFields({
      name: "  Maria   Silva ",
      document: "390.533.447-05",
      email: "Maria.Silva@Example.INVALID",
      phone: "(11) 99999-0002",
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) throw new Error(ok.error);
    expect(ok.value.name).toBe("Maria Silva");
    expect(ok.value.document).toBe("39053344705");
    expect(ok.value.email).toBe("maria.silva@example.invalid");
    expect(ok.value.phone).toBe("11999990002");
  });

  it("rejects invalid document, email and phone", () => {
    expect(validateCustomerFields({ name: "Joao", document: "123" }).ok).toBe(false);
    expect(validateCustomerFields({ name: "Joao", email: "not-an-email" }).ok).toBe(false);
    expect(validateCustomerFields({ name: "Joao", phone: "123" }).ok).toBe(false);
    expect(normalizeCustomerDocument("12.345.678/0001-90")).toBe("12345678000190");
  });

  it("filters local customers by name/document/phone/email", () => {
    const rows = [
      {
        id: "1",
        name: "Ana",
        document: "39053344705",
        email: "ana@example.invalid",
        phone: "11988887777",
      },
      {
        id: "2",
        name: "Bruno",
        document: null,
        email: null,
        phone: null,
      },
    ];
    expect(filterCustomersLocal(rows, "ana").rows).toHaveLength(1);
    expect(filterCustomersLocal(rows, "390533").rows[0]?.id).toBe("1");
    expect(filterCustomersLocal(rows, "98888").rows[0]?.id).toBe("1");
    expect(filterCustomersLocal(rows, "cliente inexistente").rows).toHaveLength(0);
  });

  it("allows cashier/manager/admin to manage customers and strips org_id from write schema", () => {
    expect(canManageCustomers("cashier")).toBe(true);
    expect(canManageCustomers(null)).toBe(false);
    const parsed = customerWriteSchema.safeParse({
      store_id: "22222222-2222-4222-8222-222222222201",
      name: "Cliente Teste",
      org_id: "11111111-1111-4111-8111-111111111111",
      document: "39053344705",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("parse failed");
    expect(parsed.data).not.toHaveProperty("org_id");
  });

  it("requires complete cursor pairs for customer queries", () => {
    const storeId = "22222222-2222-4222-8222-222222222201";
    const customerId = "55555555-5555-4555-8555-555555555502";
    expect(customerSearchQuerySchema.safeParse({ store_id: storeId, after_name: "Ana" }).success).toBe(false);
    expect(
      customerDetailQuerySchema.safeParse({
        store_id: storeId,
        customer_id: customerId,
        after_created_at: "2026-09-05T12:00:00.000Z",
      }).success
    ).toBe(false);
  });
});

describe("B19 customer migration contract", () => {
  it("adds search indexes, unique document and SECURITY DEFINER RPCs", () => {
    expect(MIGRATION).toContain("CREATE UNIQUE INDEX IF NOT EXISTS customers_org_document_unique");
    expect(MIGRATION).toContain("CREATE OR REPLACE FUNCTION public.search_customers");
    expect(MIGRATION).toContain("CREATE OR REPLACE FUNCTION public.upsert_customer");
    expect(MIGRATION).toContain("CREATE OR REPLACE FUNCTION public.get_customer_detail");
    expect(MIGRATION).toContain("SET search_path = pg_catalog, public, pg_temp");
    expect(MIGRATION).toContain("forbidden_customers");
    expect(MIGRATION).toContain("customer_document_conflict");
    expect(MIGRATION).toContain("user_has_store_access(sa.store_id)");
    expect(MIGRATION).toContain("REVOKE INSERT, UPDATE, DELETE ON TABLE public.customers");
    expect(MIGRATION).not.toMatch(/p_payload->>'org_id'/);
  });

  it("hardens literal search and direct RPC cursor validation", () => {
    expect(HARDENING_MIGRATION).toContain("customers_org_document_digits_idx");
    expect(HARDENING_MIGRATION).toContain("v_after_name IS NULL) <> (v_after_id IS NULL");
    expect(HARDENING_MIGRATION).toContain("position(v_digits IN regexp_replace");
    expect(HARDENING_MIGRATION).toContain("jsonb_agg(value ORDER BY ord)");
  });
});

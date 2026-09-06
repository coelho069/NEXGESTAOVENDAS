import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { canManageStoreSettings, canViewStoreSettings } from "@/lib/domain/rbac";
import { renderReceiptHtml, type ReceiptModel } from "@/lib/domain/receipt";
import {
  attachSettingsMeta,
  defaultStoreSettings,
  enrichReceiptWithSettings,
  saleBlockedBySettings,
  validateStoreSettingsWrite,
} from "@/lib/domain/store-settings";
import { validateCustomerFields } from "@/lib/domain/customer";
import {
  storeSettingsQuerySchema,
  storeSettingsWriteSchema,
} from "@/lib/validation/schemas";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20260905210000_b20_store_settings.sql"),
  "utf8"
);

const STORE_ID = "22222222-2222-4222-8222-222222222201";
const ORG_ID = "11111111-1111-4111-8111-111111111111";

describe("B20 store settings domain", () => {
  it("validates and normalizes commercial fields", () => {
    const ok = validateStoreSettingsWrite({
      store_id: STORE_ID,
      trade_name: "  Loja   Centro ",
      document: "12.345.678/0001-95",
      phone: "(11) 3333-4444",
      state: "sp",
      postal_code: "01310-100",
      auto_print_receipt: true,
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) throw new Error(ok.error);
    expect(ok.value.trade_name).toBe("Loja Centro");
    expect(ok.value.document).toBe("12345678000195");
    expect(ok.value.phone).toBe("1133334444");
    expect(ok.value.state).toBe("SP");
    expect(ok.value.postal_code).toBe("01310100");
    expect(ok.value.auto_print_receipt).toBe(true);
  });

  it("rejects invalid UF, CEP and document", () => {
    expect(validateStoreSettingsWrite({ store_id: STORE_ID, state: "XX" }).ok).toBe(false);
    expect(validateStoreSettingsWrite({ store_id: STORE_ID, postal_code: "123" }).ok).toBe(false);
    expect(validateStoreSettingsWrite({ store_id: STORE_ID, document: "123" }).ok).toBe(false);
  });

  it("blocks sale when customer or cash session is required", () => {
    const settings = {
      ...defaultStoreSettings(STORE_ID, ORG_ID),
      require_customer_on_sale: true,
      require_open_cash_session: true,
    };
    expect(
      saleBlockedBySettings({ settings, customerId: null, cashSessionOpen: true })
    ).toMatch(/cliente/i);
    expect(
      saleBlockedBySettings({
        settings: { ...settings, require_customer_on_sale: false },
        customerId: null,
        cashSessionOpen: false,
      })
    ).toMatch(/caixa/i);
    expect(
      saleBlockedBySettings({
        settings,
        customerId: "55555555-5555-4555-8555-555555555501",
        cashSessionOpen: true,
      })
    ).toBeNull();
  });

  it("enriches receipt with commercial identity and hides operator when configured", () => {
    const base: ReceiptModel = {
      saleId: "sale-1",
      storeName: "Loja Centro",
      createdAt: "2026-09-05T15:00:00.000Z",
      customerName: null,
      operatorName: "Caixa",
      lines: [],
      subtotal: "3.50",
      discount: "0.00",
      total: "3.50",
      payments: [{ method: "cash", amount: "3.50", status: "captured" }],
      syncStatus: "synced",
      saleStatus: "confirmed",
    };
    const enriched = enrichReceiptWithSettings(base, {
      ...defaultStoreSettings(STORE_ID, ORG_ID),
      trade_name: "Mercado Centro",
      document: "12345678000195",
      phone: "1133334444",
      address_line: "Rua A, 10",
      city: "São Paulo",
      state: "SP",
      postal_code: "01310100",
      receipt_footer: "Obrigado pela preferência",
      show_operator_on_receipt: false,
    });
    expect(enriched.storeName).toBe("Mercado Centro");
    expect(enriched.operatorName).toBeNull();
    const html = renderReceiptHtml(enriched);
    expect(html).toContain("Mercado Centro");
    expect(html).toContain("Doc. 12345678000195");
    expect(html).toContain("Obrigado pela preferência");
  });

  it("exposes payment/fiscal adapters as not_configured except cash, including TEF", () => {
    const payload = attachSettingsMeta({
      settings: defaultStoreSettings(STORE_ID, ORG_ID),
      store: { id: STORE_ID, name: "Loja Centro", code: "CENTRO", is_active: true },
      organization: {
        id: ORG_ID,
        name: "Nex Demo",
        currency: "BRL",
        timezone: "America/Sao_Paulo",
      },
      can_edit: true,
      role: "manager",
    });
    expect(payload.integrations.payments.cash).toBe("configured");
    expect(payload.integrations.payments.pix).toBe("not_configured");
    expect(payload.integrations.payments.card).toBe("not_configured");
    expect(payload.integrations.tef).toBe("not_configured");
    expect(payload.integrations.pix.status).toBe("not_configured");
    expect(payload.integrations.pix.provider).toBe("not_configured");
    expect(payload.integrations.fiscal.status).toBe("not_configured");
    expect(payload.integrations.nfce.status).toBe("not_configured");
    expect(payload.integrations.sat.status).toBe("not_configured");
    expect(payload.discount_limits.cashier).toBe("5.00");
  });

  it("requires document on customer when store setting demands it", () => {
    expect(validateCustomerFields({ name: "Ana", requireDocument: true }).ok).toBe(false);
    expect(
      validateCustomerFields({ name: "Ana", document: "39053344705", requireDocument: true }).ok
    ).toBe(true);
  });

  it("keeps RBAC: cashier can view, only manager/admin can edit", () => {
    expect(canViewStoreSettings("cashier")).toBe(true);
    expect(canManageStoreSettings("cashier")).toBe(false);
    expect(canManageStoreSettings("manager")).toBe(true);
    expect(canManageStoreSettings("admin")).toBe(true);
  });

  it("strips org_id from write schema", () => {
    const parsed = storeSettingsWriteSchema.safeParse({
      store_id: STORE_ID,
      trade_name: "Loja",
      org_id: ORG_ID,
      auto_print_receipt: true,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("parse failed");
    expect(parsed.data).not.toHaveProperty("org_id");
    expect(storeSettingsQuerySchema.safeParse({ store_id: "bad" }).success).toBe(false);
  });
});

describe("B20 store settings migration contract", () => {
  it("creates store_settings with RLS, SECURITY DEFINER RPCs and no provider secrets", () => {
    expect(MIGRATION).toContain("CREATE TABLE IF NOT EXISTS public.store_settings");
    expect(MIGRATION).toContain("CREATE OR REPLACE FUNCTION public.get_store_settings");
    expect(MIGRATION).toContain("CREATE OR REPLACE FUNCTION public.upsert_store_settings");
    expect(MIGRATION).toContain("forbidden_settings");
    expect(MIGRATION).toContain("v_role NOT IN ('admin', 'manager')");
    expect(MIGRATION).toContain("REVOKE INSERT, UPDATE, DELETE ON TABLE public.store_settings");
    expect(MIGRATION).toContain("SET search_path = pg_catalog, public, pg_temp");
    expect(MIGRATION).not.toMatch(/api[_-]?key/i);
    expect(MIGRATION).not.toMatch(/service[_-]?role/i);
    expect(MIGRATION).not.toMatch(/p_payload->>'org_id'/);
  });
});

describe("B20 settings fetch cache", () => {
  it("dedupes concurrent fetches for the same store", async () => {
    const { clearStoreSettingsCache, fetchStoreSettings } = await import("@/lib/pdv/settings-api");
    clearStoreSettingsCache();

    let resolveFetch!: (value: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(fetchPromise);
    vi.stubGlobal("fetch", fetchMock);

    const a = fetchStoreSettings(STORE_ID);
    const b = fetchStoreSettings(STORE_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(
      new Response(
        JSON.stringify({
          settings: defaultStoreSettings(STORE_ID, ORG_ID),
          store: { id: STORE_ID, name: "Loja Centro", code: "CENTRO", is_active: true },
          organization: {
            id: ORG_ID,
            name: "Nex Demo",
            currency: "BRL",
            timezone: "America/Sao_Paulo",
          },
          can_edit: true,
          role: "manager",
          integrations: {
            payments: {
              cash: "configured",
              card: "not_configured",
              pix: "not_configured",
              voucher: "not_configured",
              other: "not_configured",
            },
            tef: "not_configured",
            pix: {
              status: "not_configured",
              provider: "not_configured",
              message: "Provedor PIX não configurado",
            },
            credit_card: {
              status: "not_configured",
              provider: "not_configured",
              message: "Provedor cartão (crédito) não configurado",
            },
            debit_card: {
              status: "not_configured",
              provider: "not_configured",
              message: "Provedor cartão (débito) não configurado",
            },
            tef_detail: {
              status: "not_configured",
              provider: "not_configured",
              message: "Provedor TEF não configurado",
            },
            fiscal: {
              status: "not_configured",
              provider: "not_configured",
              message: "Provider fiscal não configurado",
            },
            nfce: {
              status: "not_configured",
              provider: "not_configured",
              message: "NFC-e não configurada",
            },
            sat: {
              status: "not_configured",
              provider: "not_configured",
              message: "SAT não configurado",
            },
          },
          discount_limits: { cashier: "5.00", manager: "20.00", admin: "100.00" },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const [left, right] = await Promise.all([a, b]);
    expect(left.settings.store_id).toBe(STORE_ID);
    expect(right.settings.store_id).toBe(STORE_ID);

    // Cached hit — no extra network call.
    await fetchStoreSettings(STORE_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clearStoreSettingsCache();
    vi.unstubAllGlobals();
  });
});

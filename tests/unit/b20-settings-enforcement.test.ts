import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  commercialFlagsFromSettings,
  defaultStoreSettings,
  evaluateSaleCommercialRules,
  resolveFiscalIntegrationStatus,
  buildIntegrationStatusView,
  saleBlockedBySettings,
} from "@/lib/domain/store-settings";
import { validateCustomerFields } from "@/lib/domain/customer";
import { loadStoreCommercialFlags } from "@/lib/server/store-settings";
import type { AuthedContext } from "@/lib/auth/session";
import { closeSale } from "@/lib/offline/close-sale";
import { createPdvLocalDb, deletePdvLocalDb } from "@/lib/offline/pdv-local-db";
import type { PdvLocalDatabase } from "@/lib/offline/pdv-local-db";

const { getAuthedContext, createClient, getFiscalProviderConfig, getPublicFiscalProviderStatus } =
  vi.hoisted(() => ({
    getAuthedContext: vi.fn(),
    createClient: vi.fn(),
    getFiscalProviderConfig: vi.fn(),
    getPublicFiscalProviderStatus: vi.fn(),
  }));

vi.mock("@/lib/auth/session", () => ({ getAuthedContext }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/server/fiscal-provider", () => ({
  getFiscalProviderConfig,
  getPublicFiscalProviderStatus,
}));
vi.mock("@/lib/server/fiscal-operation", () => ({
  requestFiscalIssueAfterCommit: vi.fn().mockResolvedValue({ data: { status: "pending" } }),
}));
vi.mock("@/lib/observability/request-context", () => ({
  createRequestObservability: () => ({
    withHeaders: <T>(value: T) => value,
  }),
  observeApiResult: vi.fn(),
}));

import { POST as processSalePost } from "@/app/api/sales/process/route";
import { POST as createCustomerPost } from "@/app/api/customers/route";
import { GET as settingsGet, PUT as settingsPut } from "@/app/api/settings/route";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const STORE_ID = "22222222-2222-4222-8222-222222222201";
const OTHER_STORE_ID = "22222222-2222-4222-8222-222222222202";
const CUSTOMER_ID = "55555555-5555-4555-8555-555555555501";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333301";
const MUTATION_ID = "99999999-9999-4999-8999-999999999901";
const SESSION_ID = "66666666-6666-4666-8666-666666666666";
const TERMINAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function managerContext(storeId = STORE_ID): AuthedContext {
  return {
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    role: "manager",
    orgId: ORG_ID,
    storeId,
    storeName: "Loja Centro",
    stores: [{ id: storeId, name: "Loja Centro", orgId: ORG_ID, role: "manager" }],
  };
}

function flags(partial: Partial<ReturnType<typeof commercialFlagsFromSettings>> = {}) {
  return commercialFlagsFromSettings({
    require_customer_on_sale: false,
    require_open_cash_session: false,
    require_customer_document: false,
    ...partial,
  });
}

function settingsRpc(partial: Partial<ReturnType<typeof commercialFlagsFromSettings>> = {}) {
  return {
    data: { settings: flags(partial) },
    error: null,
  };
}

function salePayload(overrides: Record<string, unknown> = {}) {
  return {
    store_id: STORE_ID,
    client_mutation_id: MUTATION_ID,
    items: [
      {
        product_id: PRODUCT_ID,
        quantity: 1,
        unit_price: "3.50",
        discount: "0.00",
      },
    ],
    payments: [{ method: "cash", amount: "3.50" }],
    discount: "0.00",
    cash_session_id: SESSION_ID,
    terminal_id: TERMINAL_ID,
    ...overrides,
  };
}

function request(url: string, body?: unknown, method = "POST"): Request {
  return new Request(`http://localhost${url}`, {
    method: body === undefined ? "GET" : method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function mockAuthedClient(rpcImpl: (name: string, args?: unknown) => unknown, fromImpl?: unknown) {
  createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
    rpc: vi.fn().mockImplementation(rpcImpl),
    from: fromImpl ?? vi.fn(),
  });
}

describe("B20 commercial rules domain", () => {
  it("normalizes partial flags into defined booleans", () => {
    expect(commercialFlagsFromSettings({ require_customer_on_sale: true })).toEqual({
      require_customer_on_sale: true,
      require_open_cash_session: false,
      require_customer_document: false,
    });
    expect(commercialFlagsFromSettings(null)).toEqual({
      require_customer_on_sale: false,
      require_open_cash_session: false,
      require_customer_document: false,
    });
  });

  it("rejects sale without customer when require_customer_on_sale is enabled", () => {
    const violation = evaluateSaleCommercialRules({
      settings: flags({ require_customer_on_sale: true }),
      customerId: null,
      cashSessionOpen: true,
    });
    expect(violation?.code).toBe("customer_required_on_sale");
  });

  it("allows sale with customer when require_customer_on_sale is enabled", () => {
    expect(
      evaluateSaleCommercialRules({
        settings: flags({ require_customer_on_sale: true }),
        customerId: CUSTOMER_ID,
        cashSessionOpen: true,
      })
    ).toBeNull();
  });

  it("rejects associated customer without document when document is required", () => {
    const violation = evaluateSaleCommercialRules({
      settings: flags({ require_customer_on_sale: true, require_customer_document: true }),
      customerId: CUSTOMER_ID,
      customerDocument: null,
      cashSessionOpen: true,
    });
    expect(violation?.code).toBe("customer_document_required");
  });

  it("rejects closed cash when require_open_cash_session is enabled", () => {
    expect(
      saleBlockedBySettings({
        settings: {
          ...defaultStoreSettings(STORE_ID, ORG_ID),
          require_open_cash_session: true,
        },
        customerId: CUSTOMER_ID,
        cashSessionOpen: false,
      })
    ).toMatch(/caixa/i);
  });

  it("does not require cash when require_open_cash_session is disabled", () => {
    expect(
      evaluateSaleCommercialRules({
        settings: flags({ require_open_cash_session: false }),
        customerId: null,
        cashSessionOpen: false,
      })
    ).toBeNull();
  });

  it("requires document on customer create/edit when store setting demands it", () => {
    expect(validateCustomerFields({ name: "Ana", requireDocument: true }).ok).toBe(false);
    expect(
      validateCustomerFields({ name: "Ana", document: "39053344705", requireDocument: true }).ok
    ).toBe(true);
  });

  it("reports payment adapters and TEF/fiscal from real configuration state", () => {
    const notConfigured = buildIntegrationStatusView(resolveFiscalIntegrationStatus());
    expect(notConfigured.payments.cash).toBe("configured");
    expect(notConfigured.payments.pix).toBe("not_configured");
    expect(notConfigured.payments.card).toBe("not_configured");
    expect(notConfigured.tef).toBe("not_configured");
    expect(notConfigured.pix.status).toBe("not_configured");
    expect(notConfigured.credit_card.status).toBe("not_configured");
    expect(notConfigured.debit_card.status).toBe("not_configured");
    expect(notConfigured.tef_detail.status).toBe("not_configured");
    expect(notConfigured.fiscal.status).toBe("not_configured");
    expect(notConfigured.nfce.status).toBe("not_configured");
    expect(notConfigured.sat.status).toBe("not_configured");

    const configured = buildIntegrationStatusView(
      resolveFiscalIntegrationStatus({
        configured: true,
        provider: "acme-nfce",
        message: "Provider fiscal acme-nfce configurado.",
      })
    );
    expect(configured.fiscal.status).toBe("configured");
    expect(configured.fiscal.provider).toBe("acme-nfce");
    expect(configured.tef).toBe("not_configured");
    expect(configured.nfce.status).toBe("not_configured");
    expect(configured.sat.status).toBe("not_configured");
  });
});

describe("B20 loadStoreCommercialFlags fail-closed", () => {
  it("returns defaults when settings row is absent", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: { settings: null }, error: null }),
    };
    const result = await loadStoreCommercialFlags(supabase as never, STORE_ID);
    expect(result).toEqual({
      ok: true,
      flags: flags(),
      source: "defaults",
    });
  });

  it("normalizes partial row settings", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: { settings: { require_customer_on_sale: true } },
        error: null,
      }),
    };
    const result = await loadStoreCommercialFlags(supabase as never, STORE_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.flags).toEqual(flags({ require_customer_on_sale: true }));
    expect(result.source).toBe("row");
  });

  it("fails closed on RPC read error (does not coerce to all-false)", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "connection refused" },
      }),
    };
    const result = await loadStoreCommercialFlags(supabase as never, STORE_ID);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBe("settings_unavailable");
  });

  it("fails closed on malformed payload", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: ["not-an-object"], error: null }),
    };
    const result = await loadStoreCommercialFlags(supabase as never, STORE_ID);
    expect(result.ok).toBe(false);
  });
});

describe("B20 sales API commercial enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthedContext.mockResolvedValue(managerContext());
    getFiscalProviderConfig.mockReturnValue({
      configured: false,
      provider: "not_configured",
      reason: "provider_not_configured",
    });
    getPublicFiscalProviderStatus.mockReturnValue({
      status: "not_configured",
      provider: "not_configured",
      message: "Provedor fiscal não configurado",
      methods: { nfce: "not_configured", sat: "not_configured" },
    });
  });

  it("rejects sale without customer when store requires customer (API bypass blocked)", async () => {
    mockAuthedClient((name) => {
      if (name === "get_store_settings") return settingsRpc({ require_customer_on_sale: true });
      return { data: null, error: null };
    });

    const response = await processSalePost(request("/api/sales/process", salePayload()));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: "customer_required_on_sale" });
  });

  it("allows sale with customer when store requires customer", async () => {
    mockAuthedClient((name) => {
      if (name === "get_store_settings") return settingsRpc({ require_customer_on_sale: true });
      return {
        data: { sale_id: "sale-1", client_mutation_id: MUTATION_ID, status: "confirmed" },
        error: null,
      };
    });

    const response = await processSalePost(
      request("/api/sales/process", salePayload({ customer_id: CUSTOMER_ID }))
    );
    expect(response.status).toBe(200);
  });

  it("rejects associated customer without document when document is required", async () => {
    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { document: null, org_id: ORG_ID },
            error: null,
          }),
        }),
      }),
    });
    mockAuthedClient((name) => {
      if (name === "get_store_settings") {
        return settingsRpc({ require_customer_on_sale: true, require_customer_document: true });
      }
      return { data: null, error: null };
    }, from);

    const response = await processSalePost(
      request("/api/sales/process", salePayload({ customer_id: CUSTOMER_ID }))
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: "customer_document_required" });
  });

  it("maps RPC customer_required_on_sale as authoritative rejection", async () => {
    mockAuthedClient((name) => {
      if (name === "get_store_settings") return settingsRpc();
      return { data: null, error: { message: "customer_required_on_sale", code: "22023" } };
    });

    const response = await processSalePost(
      request("/api/sales/process", salePayload({ customer_id: CUSTOMER_ID }))
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "customer_required_on_sale" });
  });

  it("rejects unauthorized store before processing sale", async () => {
    getAuthedContext.mockResolvedValue(null);
    mockAuthedClient(() => ({ data: null, error: null }));

    const response = await processSalePost(
      request("/api/sales/process", salePayload({ store_id: OTHER_STORE_ID }))
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "forbidden_store" });
  });

  it("allows process_sale without cash_session_id when require_open_cash_session=false", async () => {
    const rpc = vi.fn().mockImplementation((name: string) => {
      if (name === "get_store_settings") return settingsRpc({ require_open_cash_session: false });
      return {
        data: { sale_id: "sale-1", client_mutation_id: MUTATION_ID, status: "confirmed" },
        error: null,
      };
    });
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      rpc,
      from: vi.fn(),
    });

    const response = await processSalePost(
      request(
        "/api/sales/process",
        salePayload({
          cash_session_id: undefined,
          terminal_id: undefined,
          customer_id: CUSTOMER_ID,
        })
      )
    );
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("process_sale", expect.any(Object));
    expect(rpc).not.toHaveBeenCalledWith("process_sale_with_cash", expect.anything());
  });

  it("rejects process_sale without cash_session_id when require_open_cash_session=true", async () => {
    mockAuthedClient((name) => {
      if (name === "get_store_settings") return settingsRpc({ require_open_cash_session: true });
      return { data: null, error: null };
    });

    const response = await processSalePost(
      request(
        "/api/sales/process",
        salePayload({
          cash_session_id: undefined,
          terminal_id: undefined,
          customer_id: CUSTOMER_ID,
        })
      )
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: "cash_session_required" });
  });

  it("maps RPC cash_session_required for invalid/other-store session", async () => {
    mockAuthedClient((name) => {
      if (name === "get_store_settings") return settingsRpc({ require_open_cash_session: true });
      return { data: null, error: { message: "cash_session_required", code: "22023" } };
    });

    const response = await processSalePost(
      request("/api/sales/process", salePayload({ customer_id: CUSTOMER_ID }))
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "cash_session_required" });
  });

  it("returns 503 fail-closed when settings cannot be loaded", async () => {
    mockAuthedClient((name) => {
      if (name === "get_store_settings") {
        return { data: null, error: { message: "db down" } };
      }
      return { data: null, error: null };
    });

    const response = await processSalePost(
      request("/api/sales/process", salePayload({ customer_id: CUSTOMER_ID }))
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: "settings_unavailable" });
  });
});

describe("B20 customers API document enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthedContext.mockResolvedValue(managerContext());
  });

  it("rejects customer create without document when store requires it with HTTP 422", async () => {
    mockAuthedClient((name) => {
      if (name === "get_store_settings") return settingsRpc({ require_customer_document: true });
      return { data: null, error: null };
    });

    const response = await createCustomerPost(
      request("/api/customers", {
        store_id: STORE_ID,
        name: "Cliente Sem Doc",
      })
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: "customer_document_required" });
  });

  it("maps RPC customer_document_required on bypass attempt as HTTP 422 (not 503)", async () => {
    mockAuthedClient((name) => {
      if (name === "get_store_settings") return settingsRpc();
      return { data: null, error: { message: "customer_document_required", code: "22023" } };
    });

    const response = await createCustomerPost(
      request("/api/customers", {
        store_id: STORE_ID,
        name: "Cliente",
        document: "39053344705",
      })
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: "customer_document_required" });
  });

  it("returns 503 when settings read fails before customer create", async () => {
    mockAuthedClient((name) => {
      if (name === "get_store_settings") return { data: null, error: { message: "timeout" } };
      return { data: null, error: null };
    });

    const response = await createCustomerPost(
      request("/api/customers", { store_id: STORE_ID, name: "Cliente" })
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: "settings_unavailable" });
  });
});

describe("B20 settings API persistence and integrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthedContext.mockResolvedValue(managerContext());
  });

  it("persists settings and exposes real adapter statuses", async () => {
    getFiscalProviderConfig.mockReturnValue({
      configured: false,
      provider: "not_configured",
      reason: "provider_not_configured",
    });
    getPublicFiscalProviderStatus.mockReturnValue({
      status: "not_configured",
      provider: "not_configured",
      message: "Provedor fiscal não configurado",
      methods: { nfce: "not_configured", sat: "not_configured" },
    });
    const rpc = vi.fn().mockResolvedValue({
      data: {
        settings: {
          ...defaultStoreSettings(STORE_ID, ORG_ID),
          trade_name: "Mercado Centro",
          document: "12345678000195",
          receipt_footer: "Obrigado",
          auto_print_receipt: true,
          require_customer_on_sale: true,
          require_customer_document: true,
          updated_at: "2026-09-05T20:00:00.000Z",
          updated_by: "u1",
        },
        store: { id: STORE_ID, name: "Loja Centro", code: "CENTRO", is_active: true },
        organization: {
          id: ORG_ID,
          name: "Nex Demo",
          currency: "BRL",
          timezone: "America/Sao_Paulo",
        },
        can_edit: true,
        role: "manager",
      },
      error: null,
    });
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      rpc,
    });

    const put = await settingsPut(
      request(
        "/api/settings",
        {
          store_id: STORE_ID,
          trade_name: "Mercado Centro",
          document: "12345678000195",
          require_customer_on_sale: true,
          require_customer_document: true,
        },
        "PUT"
      )
    );
    expect(put.status).toBe(200);
    const body = await put.json();
    expect(body.settings.require_customer_on_sale).toBe(true);
    expect(body.settings.require_customer_document).toBe(true);
    expect(body.integrations.payments.cash).toBe("configured");
    expect(body.integrations.payments.pix).toBe("not_configured");
    expect(body.integrations.tef).toBe("not_configured");
    expect(body.integrations.fiscal.status).toBe("not_configured");
    expect(body.integrations.nfce.status).toBe("not_configured");
    expect(body.integrations.sat.status).toBe("not_configured");

    // Even with raw FISCAL_PROVIDER env/config present, public status stays
    // not_configured until certificate vault + live readiness exist (B24).
    getFiscalProviderConfig.mockReturnValue({
      configured: true,
      provider: "acme-nfce",
      url: "https://fiscal.example/api",
      apiKey: "secret",
      timeoutMs: 15000,
    });
    getPublicFiscalProviderStatus.mockReturnValue({
      status: "not_configured",
      provider: "not_configured",
      message: "Provedor fiscal não configurado",
      methods: { nfce: "not_configured", sat: "not_configured" },
    });
    const get = await settingsGet(request(`/api/settings?store_id=${STORE_ID}`));
    expect(get.status).toBe(200);
    const got = await get.json();
    expect(got.integrations.fiscal.status).toBe("not_configured");
    expect(got.integrations.nfce.status).toBe("not_configured");
    expect(got.integrations.sat.status).toBe("not_configured");
    expect(JSON.stringify(got.integrations)).not.toContain("secret");
  });

  it("rejects settings for another store without membership (tenant isolation)", async () => {
    getAuthedContext.mockResolvedValue(null);
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      rpc: vi.fn(),
    });
    const response = await settingsGet(request(`/api/settings?store_id=${OTHER_STORE_ID}`));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "forbidden_settings" });
  });
});

describe("B20 offline closeSale commercial rules", () => {
  const dbs: PdvLocalDatabase[] = [];

  async function openDb() {
    const db = createPdvLocalDb(`b20-offline-${Math.random().toString(16).slice(2)}`);
    await db.open();
    dbs.push(db);
    await db.inventoryBalances.put({
      storeId: STORE_ID,
      productId: PRODUCT_ID,
      quantity: "10.000",
      serverQuantity: "10.000",
      updatedAt: new Date().toISOString(),
    });
    return db;
  }

  afterEach(async () => {
    while (dbs.length > 0) {
      const db = dbs.pop();
      if (!db) continue;
      const name = db.name;
      db.close();
      await deletePdvLocalDb(name);
    }
  });

  function offlineInput(overrides: Record<string, unknown> = {}) {
    return {
      storeId: STORE_ID,
      clientMutationId: MUTATION_ID,
      lines: [
        {
          productId: PRODUCT_ID,
          sku: "BEV-001",
          name: "Água",
          unitPrice: "3.50",
          quantity: 1,
          discount: "0.00",
        },
      ],
      discount: "0.00",
      payments: [{ method: "cash" as const, amount: "3.50" }],
      cashSessionId: SESSION_ID,
      terminalId: TERMINAL_ID,
      ...overrides,
    };
  }

  it("blocks offline sale without customer when require_customer_on_sale is set", async () => {
    const db = await openDb();
    await expect(
      closeSale(
        db,
        offlineInput({
          commercialFlags: flags({ require_customer_on_sale: true }),
        })
      )
    ).rejects.toThrow(/cliente/i);
    expect(await db.sales.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it("blocks offline sale without cash session when require_open_cash_session is set", async () => {
    const db = await openDb();
    await expect(
      closeSale(
        db,
        offlineInput({
          cashSessionId: undefined,
          commercialFlags: flags({ require_open_cash_session: true }),
        })
      )
    ).rejects.toThrow(/caixa/i);
    expect(await db.outbox.count()).toBe(0);
  });

  it("allows offline sale without cash when require_open_cash_session is false", async () => {
    const db = await openDb();
    const result = await closeSale(
      db,
      offlineInput({
        cashSessionId: undefined,
        commercialFlags: flags({ require_open_cash_session: false }),
      })
    );
    expect(result.duplicate).toBe(false);
    expect(await db.outbox.count()).toBe(1);
  });
});

describe("B20 assert_store_sale_settings final SQL contract", () => {
  function finalFunctionBody(name: string): string {
    const dir = join(process.cwd(), "supabase/migrations");
    const files = readdirSync(dir)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    let body = "";
    for (const file of files) {
      const sql = readFileSync(join(dir, file), "utf8");
      const re = new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${name}\\s*\\([\\s\\S]*?\\)\\s*RETURNS[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`,
        "g"
      );
      for (const match of sql.matchAll(re)) {
        body = match[1] ?? body;
      }
    }
    return body;
  }

  it("requires explicit cash_session_id and does not fall back to any open session", () => {
    const body = finalFunctionBody("assert_store_sale_settings");
    expect(body).toMatch(/cash_session_required/);
    expect(body).toMatch(/v_cash_session_id IS NULL/);
    expect(body).not.toMatch(/SELECT EXISTS\s*\(\s*SELECT 1\s*FROM public\.cash_sessions/i);
    expect(body).toMatch(/v_session\.store_id IS DISTINCT FROM v_store_id/);
    expect(body).toMatch(/v_session\.org_id IS DISTINCT FROM v_org_id/);
    expect(body).toMatch(/v_session\.status <> 'open'/);
  });

  it("forwards cash_session_id from process_sale_with_cash into process_sale", () => {
    const body = finalFunctionBody("process_sale_with_cash");
    expect(body).toMatch(/process_sale\(\s*[\s\S]*p_payload - 'terminal_id'/);
    expect(body).not.toMatch(/p_payload - 'cash_session_id' - 'terminal_id'/);
  });
});

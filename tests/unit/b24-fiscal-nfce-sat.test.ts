import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getFiscalAdapterByKind,
  getNfceFiscalAdapter,
  getSatFiscalAdapter,
  NotConfiguredFiscalAdapter,
} from "@/lib/adapters/fiscal";
import {
  assertFiscalResultNotFakeIssued,
  buildFiscalDocumentContract,
  commercialReceiptDisclaimer,
  fiscalQrAvailability,
  resolveFiscalExternalCancelOutcome,
  toLifecycleFiscalStatus,
  toPersistedFiscalStatus,
} from "@/lib/domain/fiscal";
import { canTransitionFiscal } from "@/lib/domain/fiscal-state";
import { renderReceiptHtml, type ReceiptModel } from "@/lib/domain/receipt";
import { attachSettingsMeta, defaultStoreSettings } from "@/lib/domain/store-settings";
import {
  getFiscalProviderConfig,
  getPublicFiscalProviderStatus,
  isFiscalPubliclyConfigured,
} from "@/lib/server/fiscal-provider";
import { runFiscalKindOperation } from "@/lib/server/fiscal-operations";

const { getAuthedContext, createClient } = vi.hoisted(() => ({
  getAuthedContext: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getAuthedContext }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/observability/request-context", () => ({
  createRequestObservability: () => ({
    withHeaders: <T>(value: T) => value,
  }),
  observeApiResult: vi.fn(),
}));

import { POST as fiscalDocumentsPost } from "@/app/api/fiscal/documents/route";
import { POST as fiscalIssuePost } from "@/app/api/fiscal/issue/route";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const STORE_ID = "22222222-2222-4222-8222-222222222201";
const OTHER_STORE = "22222222-2222-4222-8222-222222222202";
const SALE_ID = "33333333-3333-4333-8333-333333333301";
const MUTATION_ID = "99999999-9999-4999-8999-999999999901";
const MUTATION_ID_2 = "99999999-9999-4999-8999-999999999902";
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function authContext(role: "cashier" | "manager" | "admin", storeId = STORE_ID) {
  return {
    userId: USER_ID,
    role,
    orgId: ORG_ID,
    storeId,
    storeName: "Loja Centro",
    stores: [{ id: storeId, name: "Loja Centro", orgId: ORG_ID, role }],
  };
}

describe("B24 fiscal contract and states", () => {
  it("maps lifecycle aliases onto persisted statuses without inventing issued", () => {
    expect(toPersistedFiscalStatus("authorized")).toBe("issued");
    expect(toPersistedFiscalStatus("rejected")).toBe("failed");
    expect(toPersistedFiscalStatus("contingency")).toBe("pending");
    expect(toPersistedFiscalStatus("draft")).toBe("pending");
    expect(toPersistedFiscalStatus("not_configured")).toBe("not_configured");
    expect(toLifecycleFiscalStatus("issued")).toBe("authorized");
    expect(canTransitionFiscal("pending", "issued")).toBe(true);
    expect(canTransitionFiscal("not_configured", "issued")).toBe(false);
  });

  it("strips forged access_key/protocol unless status is really issued", () => {
    const pending = buildFiscalDocumentContract({
      documentId: "d1",
      saleId: SALE_ID,
      storeId: STORE_ID,
      status: "pending",
      accessKey: "FAKE-KEY",
      protocol: "FAKE-PROTO",
      idempotencyKey: MUTATION_ID,
    });
    expect(pending.accessKey).toBeNull();
    expect(pending.protocol).toBeNull();

    const issued = buildFiscalDocumentContract({
      documentId: "d1",
      saleId: SALE_ID,
      storeId: STORE_ID,
      status: "issued",
      accessKey: "REAL-KEY",
      protocol: "REAL-PROTO",
      idempotencyKey: MUTATION_ID,
    });
    expect(issued.accessKey).toBe("REAL-KEY");
  });

  it("QR fiscal stays unavailable without issued+accessKey", () => {
    expect(
      fiscalQrAvailability({ status: "pending", accessKey: "X" }).available
    ).toBe(false);
    expect(
      fiscalQrAvailability({ status: "issued", accessKey: null }).available
    ).toBe(false);
    expect(
      fiscalQrAvailability({ status: "issued", accessKey: "3526..." }).available
    ).toBe(true);
  });
});

describe("B24 NFC-e / SAT adapters not_configured", () => {
  it.each(["nfce", "sat"] as const)(
    "%s never returns issued for issue/consult/cancel",
    async (kind) => {
      const adapter = getFiscalAdapterByKind(kind);
      expect(await adapter.issue("doc-1")).toMatchObject({ status: "not_configured" });
      expect(await adapter.consult("doc-1")).toMatchObject({ status: "not_configured" });
      expect(await adapter.cancel("doc-1")).toMatchObject({ status: "not_configured" });
      expect((await adapter.issue("doc-1")).status).not.toBe("issued");
      expect(() => assertFiscalResultNotFakeIssued("issued", kind)).toThrow(
        /illegal_issued_status/
      );
      expect(() => assertFiscalResultNotFakeIssued("authorized", kind)).toThrow(
        /illegal_issued_status/
      );
    }
  );

  it("server kind operations stay not_configured", () => {
    expect(isFiscalPubliclyConfigured("nfce")).toBe(false);
    expect(isFiscalPubliclyConfigured("sat")).toBe(false);
    expect(
      runFiscalKindOperation("issue", {
        kind: "nfce",
        intent: { storeId: STORE_ID, saleId: SALE_ID, kind: "nfce" },
      })
    ).toMatchObject({ status: "not_configured", authorized: false });
    expect(
      runFiscalKindOperation("consult", { kind: "sat", documentId: "d1" }).status
    ).toBe("not_configured");
    expect(
      runFiscalKindOperation("cancel", { kind: "nfce", documentId: "d1" }).status
    ).toBe("not_configured");
    expect(resolveFiscalExternalCancelOutcome("nfce")).toMatchObject({
      status: "not_configured",
      fiscalCancelStatus: "pending_external",
    });
    expect(getNfceFiscalAdapter().kind).toBe("nfce");
    expect(getSatFiscalAdapter().kind).toBe("sat");
    expect(new NotConfiguredFiscalAdapter().issue("x").status).toBe("not_configured");
  });
});

describe("B24 fiscal provider secrets", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps NFC-e/SAT not_configured publicly even with env credentials", () => {
    vi.stubEnv("FISCAL_PROVIDER", "acme-nfce");
    vi.stubEnv("FISCAL_PROVIDER_URL", "https://fiscal.example/api");
    vi.stubEnv("FISCAL_PROVIDER_API_KEY", "super-secret-key");
    expect(getFiscalProviderConfig().configured).toBe(true);
    const publicStatus = getPublicFiscalProviderStatus();
    expect(publicStatus.methods.nfce).toBe("not_configured");
    expect(publicStatus.methods.sat).toBe("not_configured");
    expect(JSON.stringify(publicStatus)).not.toContain("super-secret-key");
    expect(JSON.stringify(publicStatus)).not.toContain("fiscal.example");
  });
});

describe("B24 settings + receipt projections", () => {
  it("exposes NFC-e/SAT blocks without secrets", () => {
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
    expect(payload.integrations.nfce.status).toBe("not_configured");
    expect(payload.integrations.sat.status).toBe("not_configured");
    expect(payload.integrations.fiscal.status).toBe("not_configured");
    expect(JSON.stringify(payload.integrations)).not.toMatch(/api[_-]?key|certificate|private/i);
  });

  it("commercial receipt is not an authorized fiscal document and has no fake QR", () => {
    const model: ReceiptModel = {
      saleId: SALE_ID,
      storeName: "Loja Centro",
      createdAt: "2026-01-01T12:00:00.000Z",
      customerName: null,
      lines: [],
      subtotal: "10.00",
      discount: "0.00",
      total: "10.00",
      payments: [{ method: "cash", amount: "10.00", status: "captured" }],
      syncStatus: "pending",
      saleStatus: "confirmed",
      fiscalStatus: "not_configured",
    };
    const html = renderReceiptHtml(model);
    expect(html).toMatch(/Comprovante comercial/i);
    expect(html).toMatch(/QR Code fiscal indisponível|indisponível/i);
    expect(html).not.toMatch(/chave FAKE|protocolo FAKE/i);
    expect(commercialReceiptDisclaimer("not_configured")).toMatch(/não constitui/i);
    expect(html).toContain('data-receipt-fiscal-qr="unavailable"');
  });
});

describe("B24 fiscal APIs security + idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthedContext.mockResolvedValue(authContext("manager"));
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      rpc: vi.fn(),
    });
  });

  it("rejects unauthenticated NFC-e issue", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      rpc: vi.fn(),
    });
    const response = await fiscalDocumentsPost(
      new Request("http://localhost/api/fiscal/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "issue",
          kind: "nfce",
          store_id: STORE_ID,
          sale_id: SALE_ID,
          client_mutation_id: MUTATION_ID,
        }),
      })
    );
    expect(response.status).toBe(401);
  });

  it("rejects cross-store and cross-org", async () => {
    getAuthedContext.mockResolvedValue(null);
    const response = await fiscalDocumentsPost(
      new Request("http://localhost/api/fiscal/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "issue",
          kind: "sat",
          store_id: OTHER_STORE,
          sale_id: SALE_ID,
          client_mutation_id: MUTATION_ID,
        }),
      })
    );
    expect(response.status).toBe(403);
  });

  it.each(["cashier", "manager", "admin"] as const)(
    "role %s can attempt issue but receives not_configured (never authorized)",
    async (role) => {
      getAuthedContext.mockResolvedValue(authContext(role));
      const response = await fiscalDocumentsPost(
        new Request("http://localhost/api/fiscal/documents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            operation: "issue",
            kind: "nfce",
            store_id: STORE_ID,
            sale_id: SALE_ID,
            client_mutation_id: MUTATION_ID,
            status: "authorized",
            access_key: "FAKE",
            protocol: "FAKE",
          }),
        })
      );
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error).toBe("fiscal_not_configured");
      expect(body.authorized).toBe(false);
      expect(body.status).not.toBe("issued");
    }
  );

  it("SAT consult/cancel stay not_configured; cancel rejects cashier", async () => {
    getAuthedContext.mockResolvedValue(authContext("manager"));
    for (const operation of ["consult", "cancel"] as const) {
      const response = await fiscalDocumentsPost(
        new Request("http://localhost/api/fiscal/documents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            operation,
            kind: "sat",
            store_id: STORE_ID,
            document_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            client_mutation_id: MUTATION_ID,
          }),
        })
      );
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.adapter_status).toBe("not_configured");
      if (operation === "cancel") {
        expect(body.fiscal_cancel_status).toBe("pending_external");
      }
    }

    getAuthedContext.mockResolvedValue(authContext("cashier"));
    const cashierCancel = await fiscalDocumentsPost(
      new Request("http://localhost/api/fiscal/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "cancel",
          kind: "nfce",
          store_id: STORE_ID,
          document_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          client_mutation_id: MUTATION_ID,
        }),
      })
    );
    expect(cashierCancel.status).toBe(403);
  });

  it("idempotent/concurrent retries stay not_configured without inventing issued", async () => {
    const bodies = [MUTATION_ID, MUTATION_ID, MUTATION_ID_2];
    const responses = await Promise.all(
      bodies.map((client_mutation_id) =>
        fiscalDocumentsPost(
          new Request("http://localhost/api/fiscal/documents", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              operation: "issue",
              kind: "nfce",
              store_id: STORE_ID,
              sale_id: SALE_ID,
              client_mutation_id,
            }),
          })
        )
      )
    );
    for (const response of responses) {
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error).toBe("fiscal_not_configured");
      expect(body.authorized).toBe(false);
    }
  });

  it("legacy issue route rejects client-forged access_key/protocol/status", async () => {
    const response = await fiscalIssuePost(
      new Request("http://localhost/api/fiscal/issue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          store_id: STORE_ID,
          sale_id: SALE_ID,
          status: "issued",
          access_key: "3526FAKE",
          protocol: "123",
        }),
      })
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "fiscal_client_authority_rejected",
    });
  });
});

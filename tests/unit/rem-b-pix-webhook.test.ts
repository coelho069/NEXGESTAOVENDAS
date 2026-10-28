import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/payments/mercadopago/webhook/route";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createMercadoPagoPixGateway,
  getMercadoPagoEnv,
  isMercadoPagoCheckoutEnabled,
} from "@/lib/server/mercadopago";

// Regressão B2: webhook Pix Mercado Pago. Provedor simulado (gateway mockado), banco mockado.
// Sem rede, sem credenciais reais, sem eventos reais. A assinatura HMAC é calculada de verdade.

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

vi.mock("@/lib/server/mercadopago", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/mercadopago")>();
  return {
    ...actual,
    getMercadoPagoEnv: vi.fn(),
    isMercadoPagoCheckoutEnabled: vi.fn(),
    createMercadoPagoPixGateway: vi.fn(),
  };
});

const SECRET = "unit-webhook-secret";
const ORDER = "ORD01HRYFWNYRE1MR1E60MW3X0T2P";
const OTHER = "ORD01OTHEROTHEROTHEROTHER00";
const STORE = "11111111-1111-4111-8111-111111111111";
const MUTATION = "22222222-2222-4222-8222-222222222222";
const SALE = "44444444-4444-4444-8444-444444444444";
const REQUEST_ID = "req-unit-1";
const TS = "1760000000";

const getEnv = vi.mocked(getMercadoPagoEnv);
const checkoutEnabled = vi.mocked(isMercadoPagoCheckoutEnabled);
const gatewayFactory = vi.mocked(createMercadoPagoPixGateway);
const adminFactory = vi.mocked(createAdminClient);

let retrieve: ReturnType<typeof vi.fn>;
let rpc: ReturnType<typeof vi.fn>;

function signature(dataId: string | null): string {
  const parts: string[] = [];
  if (dataId) parts.push(`id:${dataId.toLowerCase()}`);
  parts.push(`request-id:${REQUEST_ID}`);
  parts.push(`ts:${TS}`);
  const manifest = `${parts.join(";")};`;
  const hash = createHmac("sha256", SECRET).update(manifest).digest("hex");
  return `ts=${TS},v1=${hash}`;
}

function webhookRequest(input: { queryId: string | null; bodyId: string; action?: string; signedFor?: string | null }) {
  const url = new URL("https://app.test/api/payments/mercadopago/webhook");
  if (input.queryId !== null) url.searchParams.set("data.id", input.queryId);
  const body = JSON.stringify({
    id: 987654,
    type: "order",
    action: input.action ?? "order.processed",
    live_mode: false,
    data: { id: input.bodyId },
  });
  const signedId = input.signedFor === undefined ? input.queryId : input.signedFor;
  return new Request(url.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature": signature(signedId),
      "x-request-id": REQUEST_ID,
    },
    body,
  });
}

function snapshot(status: string, statusDetail: string, id = ORDER) {
  return {
    id,
    status,
    statusDetail,
    amount: "5.00",
    currency: "BRL",
    livemode: false,
    received: true,
    qr: null,
  };
}

function rpcByName(overrides: Record<string, unknown> = {}) {
  rpc = vi.fn(async (name: string) => {
    if (name in overrides) return overrides[name] as { data: unknown; error: unknown };
    if (name === "apply_pix_provider_event") {
      return { data: { store_id: STORE, client_mutation_id: MUTATION, sale_id: null }, error: null };
    }
    if (name === "process_pix_sale") {
      return { data: { sale_id: SALE, status: "confirmed" }, error: null };
    }
    return { data: null, error: null };
  });
  adminFactory.mockReturnValue({ rpc } as unknown as ReturnType<typeof createAdminClient>);
}

describe("B2 Mercado Pago Pix webhook", () => {
  beforeEach(() => {
    checkoutEnabled.mockReturnValue(true);
    getEnv.mockReturnValue({
      configured: true,
      accessToken: "TEST-unit-token",
      webhookSecret: SECRET,
      timeoutMs: 5_000,
    } as unknown as ReturnType<typeof getMercadoPagoEnv>);
    retrieve = vi.fn(async () => snapshot("processed", "accredited"));
    gatewayFactory.mockReturnValue({ retrieve } as unknown as ReturnType<typeof createMercadoPagoPixGateway>);
    rpcByName();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 503 without any effect when checkout is disabled", async () => {
    checkoutEnabled.mockReturnValue(false);
    const response = await POST(webhookRequest({ queryId: ORDER, bodyId: ORDER }));
    expect(response.status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("rejects a body data.id that differs from the signed data.id, with no effect and no provider call", async () => {
    const response = await POST(webhookRequest({ queryId: ORDER, bodyId: OTHER }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "mercadopago_webhook_binding_mismatch" });
    expect(rpc).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("rejects an event without a signed data.id in the query", async () => {
    const response = await POST(webhookRequest({ queryId: null, bodyId: ORDER, signedFor: null }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature before reading the body", async () => {
    const request = webhookRequest({ queryId: ORDER, bodyId: ORDER });
    const tampered = new Request(request.url, {
      method: "POST",
      headers: { ...Object.fromEntries(request.headers), "x-signature": `ts=${TS},v1=${"0".repeat(64)}` },
      body: await request.text(),
    });
    const response = await POST(tampered);
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("applies when the signed id matches the body and the provider confirms the status", async () => {
    const response = await POST(webhookRequest({ queryId: ORDER, bodyId: ORDER }));
    expect(response.status).toBe(200);
    expect(retrieve).toHaveBeenCalledWith({ providerReference: ORDER });
    expect(rpc.mock.calls.map((call) => call[0])).toEqual(["apply_pix_provider_event", "process_pix_sale"]);
    const payload = rpc.mock.calls[0]?.[1]?.p_payload as { provider_ref: string; status: string };
    expect(payload).toMatchObject({ provider_ref: ORDER, status: "captured" });
    await expect(response.json()).resolves.toMatchObject({ sale_confirmed: true, sale_id: SALE });
  });

  it("does not apply when the body says processed but the provider says pending", async () => {
    retrieve.mockResolvedValueOnce(snapshot("action_required", "waiting_transfer"));
    const response = await POST(webhookRequest({ queryId: ORDER, bodyId: ORDER }));
    expect(response.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ status: "unknown", sale_confirmed: false });
  });

  it("a replayed event (same event id) is idempotent: no second sale confirmation", async () => {
    rpcByName({
      apply_pix_provider_event: {
        data: { store_id: STORE, client_mutation_id: MUTATION, sale_id: SALE, replay: true },
        error: null,
      },
    });
    const response = await POST(webhookRequest({ queryId: ORDER, bodyId: ORDER }));
    expect(response.status).toBe(200);
    expect(rpc.mock.calls.map((call) => call[0])).toEqual(["apply_pix_provider_event"]);
    await expect(response.json()).resolves.toMatchObject({ replay: true, sale_confirmed: true });
  });

  it("ignores order.updated (not a state-changing action): no RPC and no state write", async () => {
    const response = await POST(
      webhookRequest({ queryId: ORDER, bodyId: ORDER, action: "order.updated" })
    );
    expect(response.status).toBe(200);
    expect(retrieve).toHaveBeenCalledWith({ providerReference: ORDER });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 503 and applies nothing when the provider cannot be queried", async () => {
    retrieve.mockRejectedValueOnce(new Error("network down"));
    const response = await POST(webhookRequest({ queryId: ORDER, bodyId: ORDER }));
    expect(response.status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not apply when the provider answers for a different order", async () => {
    retrieve.mockResolvedValueOnce(snapshot("processed", "accredited", OTHER));
    const response = await POST(webhookRequest({ queryId: ORDER, bodyId: ORDER }));
    expect(response.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });
});

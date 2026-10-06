import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { refundIdempotencyKey } from "@/lib/domain/mercadopago-refund";
import {
  createMemorySandboxRefundStore,
  createSandboxRefundProvider,
  processSandboxMercadoPagoRefund,
  redactRefundError,
  sandboxRefundId,
  type SandboxPayment,
  type SandboxRefundProvider,
  type SandboxRefundRequest,
  type SandboxRefundStore,
} from "@/lib/domain/mercadopago-refund-sandbox";
import { processMercadoPagoRefund } from "@/lib/domain/mercadopago-refund-processing";
import { dryRunMercadoPagoRefundAdapter } from "@/lib/domain/mercadopago-refund-adapter";
import { createMemoryRefundAttemptStore } from "@/lib/domain/mercadopago-refund-processing";
import {
  completePersistedSandboxRefund,
  dispatchPersistedSandboxRefund,
} from "@/lib/server/refund-sandbox-settlement";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_REQUEST = "44444444-4444-4444-8444-444444444444";
const SANDBOX_ID = "sandbox_0123456789abcdef0123456789abcdef";

function payment(overrides: Partial<SandboxPayment> = {}): SandboxPayment {
  return {
    mpPaymentId: "910735180001",
    ownerUserId: OWNER,
    currency: "BRL",
    amount: "100.00",
    provider: "mercadopago",
    status: "approved",
    paidAt: "2026-10-01T15:00:00.000Z",
    ...overrides,
  };
}

function request(overrides: Partial<SandboxRefundRequest> = {}): SandboxRefundRequest {
  return {
    id: REQUEST_ID,
    status: "approved",
    mpPaymentId: "910735180001",
    ownerUserId: OWNER,
    ...overrides,
  };
}

function run(
  overrides: Partial<Parameters<typeof processSandboxMercadoPagoRefund>[0]> = {},
  store: SandboxRefundStore = createMemorySandboxRefundStore()
) {
  return processSandboxMercadoPagoRefund({
    actorUserId: OWNER,
    request: request(),
    payment: payment(),
    provider: createSandboxRefundProvider("success"),
    store,
    ...overrides,
  });
}

function gatedProvider(gate: Promise<void>): SandboxRefundProvider & { started(): number } {
  const inner = createSandboxRefundProvider("success");
  let started = 0;
  return {
    get scenario() {
      return inner.scenario;
    },
    setScenario(next) {
      inner.setScenario(next);
    },
    logicalOperationCount: () => inner.logicalOperationCount(),
    callCount: () => started,
    started: () => started,
    async execute(command) {
      started += 1;
      await gate;
      return inner.execute(command);
    },
  };
}

describe("sandbox refund processing", () => {
  it("lets an approved request with a snapshot reach the mock provider", async () => {
    const provider = createSandboxRefundProvider("success");
    const store = createMemorySandboxRefundStore();
    const result = await run({ provider, store });
    expect(result).toMatchObject({
      ok: true,
      status: "refunded",
      financialEffect: false,
      providerRefundStatus: "completed",
      providerRefundId: sandboxRefundId(refundIdempotencyKey(REQUEST_ID)),
      idempotencyKey: refundIdempotencyKey(REQUEST_ID),
      refundRequestStatus: "refunded",
      attempts: 1,
    });
    expect(result.processingFinishedAt).toEqual(expect.any(String));
    expect(provider.logicalOperationCount()).toBe(1);
    expect(result.audits.map((event) => event.event)).toEqual([
      "refund_processing_started",
      "refund_processing_succeeded",
    ]);
    expect(JSON.stringify(result.audits)).not.toContain("access_token");
  });

  it("returns paid_amount_unavailable when the snapshot or the paid instant is missing", async () => {
    const provider = createSandboxRefundProvider("success");
    expect(await run({ provider, payment: payment({ amount: null }) })).toMatchObject({
      ok: false,
      error: "paid_amount_unavailable",
      financialEffect: false,
    });
    expect(await run({ provider, payment: payment({ paidAt: null }) })).toMatchObject({
      ok: false,
      error: "paid_amount_unavailable",
    });
    expect(provider.callCount()).toBe(0);
  });

  it("rejects a payment owned by another client", async () => {
    const result = await run({
      request: request({ ownerUserId: OTHER, mpPaymentId: "910735180099" }),
      payment: payment({ ownerUserId: OTHER, mpPaymentId: "910735180099" }),
      untrusted: { payerEmail: "owner-a@gmail.com" },
    });
    expect(result).toMatchObject({ ok: false, error: "not_owner", financialEffect: false, providerRefundId: null });
  });

  it("rejects a client amount and a provider amount that differ from the snapshot", async () => {
    expect(await run({ untrusted: { amount: "10.00" } })).toMatchObject({
      ok: false,
      error: "client_amount_rejected",
    });
    const hostile: SandboxRefundProvider = {
      scenario: "success",
      callCount: () => 1,
      logicalOperationCount: () => 0,
      setScenario() {
        return undefined;
      },
      execute() {
        return {
          kind: "confirmed",
          providerRefundId: SANDBOX_ID,
          amount: "1.00",
          currency: "BRL",
          duplicate: false,
        };
      },
    };
    const store = createMemorySandboxRefundStore();
    const result = await run({ provider: hostile, store });
    expect(result).toMatchObject({
      ok: false,
      error: "snapshot_amount_mismatch",
      financialEffect: false,
      refundRequestStatus: "processing",
      providerRefundId: null,
    });
    expect((await store.inspect(REQUEST_ID))?.status).not.toBe("refunded");
  });

  it("rejects a currency other than BRL", async () => {
    const result = await run({ payment: payment({ currency: "USD" }) });
    expect(result).toMatchObject({ ok: false, error: "invalid_currency", financialEffect: false });
  });

  it("marks refunded only after the mock confirms a sandbox id", async () => {
    const store = createMemorySandboxRefundStore();
    const result = await run({ store });
    const row = await store.inspect(REQUEST_ID);
    expect(result.providerRefundId).toMatch(/^sandbox_[a-f0-9]{32}$/);
    expect(row).toMatchObject({
      status: "refunded",
      providerRefundStatus: "completed",
      financialEffect: false,
      providerRefundId: result.providerRefundId,
    });
    expect(row?.processingFinishedAt).toEqual(expect.any(String));
  });

  it("keeps a temporary error retryable with the same idempotency key", async () => {
    const provider = createSandboxRefundProvider("temporary_error");
    const store = createMemorySandboxRefundStore();
    const key = refundIdempotencyKey(REQUEST_ID);
    const first = await run({ provider, store });
    const blocked = await run({ provider, store });
    provider.setScenario("success");
    const retried = await run({ provider, store, retry: true });
    expect(first).toMatchObject({
      ok: false,
      error: "provider_unavailable",
      retryable: true,
      idempotencyKey: key,
      attempts: 1,
      refundRequestStatus: "processing",
      providerRefundStatus: "failed",
    });
    expect(first.refundRequestStatus).not.toBe("refunded");
    expect(blocked).toMatchObject({ ok: false, retryable: true, idempotencyKey: key, attempts: 1 });
    expect(retried).toMatchObject({
      ok: true,
      idempotencyKey: key,
      attempts: 2,
      financialEffect: false,
      providerRefundStatus: "completed",
    });
    expect(provider.logicalOperationCount()).toBe(1);
    expect((await store.inspect(REQUEST_ID))?.lastError).toBeNull();
  });

  it("does not mark a permanent error refunded and does not retry it", async () => {
    const provider = createSandboxRefundProvider("permanent_error");
    const store = createMemorySandboxRefundStore();
    const first = await run({ provider, store });
    const retried = await run({ provider, store, retry: true });
    expect(first).toMatchObject({
      ok: false,
      error: "refund_not_allowed",
      retryable: false,
      errorClass: "permanent",
      providerRefundStatus: "failed",
    });
    expect(first.refundRequestStatus).not.toBe("refunded");
    expect(retried).toMatchObject({ ok: false, error: "not_retryable", attempts: 1 });
    expect(provider.callCount()).toBe(1);
    expect(provider.logicalOperationCount()).toBe(0);
  });

  it("does not treat a timeout as success or as a known failure", async () => {
    const provider = createSandboxRefundProvider("timeout");
    const store = createMemorySandboxRefundStore();
    const key = refundIdempotencyKey(REQUEST_ID);
    const first = await run({ provider, store });
    const row = await store.inspect(REQUEST_ID);
    expect(first).toMatchObject({
      ok: false,
      error: "provider_timeout",
      retryable: true,
      idempotencyKey: key,
      providerRefundStatus: "processing",
      processingState: "unknown",
      errorClass: "timeout",
      providerRefundId: null,
      processingFinishedAt: null,
    });
    expect(first.refundRequestStatus).not.toBe("refunded");
    expect(row?.providerRefundStatus).not.toBe("failed");
    expect(first.audits.map((event) => event.event)).toEqual([
      "refund_processing_started",
      "refund_processing_timeout",
    ]);
    provider.setScenario("success");
    const retried = await run({ provider, store, retry: true });
    expect(retried).toMatchObject({ ok: true, idempotencyKey: key, attempts: 2, financialEffect: false });
    expect(provider.logicalOperationCount()).toBe(1);
  });

  it("reuses one idempotency key for a repeated request, a retry, and a duplicate provider response", async () => {
    const provider = createSandboxRefundProvider("duplicate_response");
    const store = createMemorySandboxRefundStore();
    const key = refundIdempotencyKey(REQUEST_ID);
    const first = await run({ provider, store });
    const second = await run({ provider, store });
    expect(first).toMatchObject({ ok: true, replayed: false, idempotencyKey: key, financialEffect: false });
    expect(second).toMatchObject({ ok: true, replayed: true, idempotencyKey: key, providerRefundId: first.providerRefundId });
    expect(provider.logicalOperationCount()).toBe(1);
    expect(provider.callCount()).toBe(2);
  });

  it("lets only one of two concurrent executions take the claim", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = gatedProvider(gate);
    const store = createMemorySandboxRefundStore();
    const first = run({ provider, store });
    const second = run({ provider, store });
    await vi.waitFor(() => expect(provider.started()).toBe(1));
    release?.();
    const results = await Promise.all([first, second]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results).toContainEqual(expect.objectContaining({ ok: false, error: "processing_in_progress" }));
    expect(provider.logicalOperationCount()).toBe(1);
    expect(provider.started()).toBe(1);
  });

  it("preserves the claim when processing is still open after a restart", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = gatedProvider(gate);
    const store = createMemorySandboxRefundStore();
    const key = refundIdempotencyKey(REQUEST_ID);
    const first = run({ provider, store });
    await vi.waitFor(() => expect(provider.started()).toBe(1));
    const restarted = await run({ provider, store });
    const row = await store.inspect(REQUEST_ID);
    expect(restarted).toMatchObject({
      ok: false,
      error: "processing_in_progress",
      idempotencyKey: key,
      attempts: 1,
    });
    expect(row).toMatchObject({ idempotencyKey: key, processingAttempts: 1, providerRefundId: null, financialEffect: false });
    release?.();
    expect(await first).toMatchObject({ ok: true, financialEffect: false, idempotencyKey: key });
    expect(provider.logicalOperationCount()).toBe(1);
  });

  it("does not process a refund that is already refunded, rejected, cancelled, or still requested", async () => {
    const provider = createSandboxRefundProvider("success");
    const store = createMemorySandboxRefundStore();
    await run({ provider, store });
    const replay = await run({ provider, store, request: request({ status: "refunded" }) });
    expect(replay).toMatchObject({ ok: true, replayed: true, financialEffect: false });
    expect(provider.callCount()).toBe(1);
    expect(await run({ provider, request: request({ status: "refunded", id: OTHER_REQUEST }) })).toMatchObject({
      ok: false,
      error: "already_refunded",
    });
    expect(await run({ provider, request: request({ status: "rejected" }) })).toMatchObject({ ok: false, error: "not_approved" });
    expect(await run({ provider, request: request({ status: "withdrawn" }) })).toMatchObject({ ok: false, error: "not_approved" });
    expect(await run({ provider, request: request({ status: "submitted" }) })).toMatchObject({ ok: false, error: "not_approved" });
    expect(await run({ provider, request: request({ status: "in_review" }) })).toMatchObject({ ok: false, error: "not_approved" });
    expect(await run({ provider, request: request({ status: "processing" }) })).toMatchObject({ ok: false, error: "not_approved" });
    expect(provider.logicalOperationCount()).toBe(1);
  });

  it("stops temporary retries instead of looping forever", async () => {
    const provider = createSandboxRefundProvider("temporary_error");
    const store = createMemorySandboxRefundStore();
    await run({ provider, store });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await run({ provider, store, retry: true });
    }
    const exhausted = await run({ provider, store, retry: true });
    expect(exhausted).toMatchObject({ ok: false, error: "retry_exhausted", attempts: 5 });
    expect(provider.callCount()).toBe(5);
    expect(provider.logicalOperationCount()).toBe(0);
  });

  it("redacts secret-shaped provider errors and ignores a forged payer email", async () => {
    expect(redactRefundError("timeout access_token=hidden")).toBe("redacted");
    const result = await run({ untrusted: { payerEmail: "attacker@gmail.com" } });
    expect(result).toMatchObject({ ok: true, financialEffect: false });
    expect(JSON.stringify(result)).not.toContain("attacker@gmail.com");
  });
});

describe("sandbox financial isolation", () => {
  it("fails if the sandbox path calls Mercado Pago, Stripe, or any external HTTP", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("api.mercadopago.com") || url.includes("api.stripe.com")) {
        throw new Error("financial_network_forbidden");
      }
      throw new Error("external_http_forbidden");
    });
    const scenarios = ["success", "temporary_error", "permanent_error", "timeout", "duplicate_response"] as const;
    for (const scenario of scenarios) {
      await run({
        provider: createSandboxRefundProvider(scenario),
        store: createMemorySandboxRefundStore(),
        request: request({ id: `55555555-5555-4555-8555-55555555555${scenarios.indexOf(scenario)}` }),
      });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("keeps provider source, settlement, and the local migration off the network and off real credentials", () => {
    const files = [
      "src/lib/domain/mercadopago-refund-sandbox.ts",
      "src/lib/server/refund-sandbox-settlement.ts",
      "supabase/migrations/20261006193000_refund_sandbox_processing.sql",
    ];
    const source = files.map((file) => readFileSync(join(process.cwd(), file), "utf8")).join("\n");
    expect(source).not.toContain("api.mercadopago.com");
    expect(source).not.toContain("api.stripe.com");
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("process.env");
    expect(source).not.toContain("ACCESS_TOKEN");
    expect(source).not.toContain("sk_live");
    expect(source).not.toContain("APP_USR");
    expect(source).not.toContain("contractedAmount");
    expect(source).not.toContain("plans.amount");
    expect(source).toContain("financial_effect");
    expect(source).toContain("refund_processing_succeeded");
    expect(source).toContain("status = 'refunded'");
    expect(source).toContain("provider_refund_status = 'completed'");
  });

  it("refuses a real-looking provider id before the database call and refuses a true financial effect", async () => {
    const calls: string[] = [];
    const admin = {
      rpc: async (name: string) => {
        calls.push(name);
        if (name === "dispatch_sandbox_refund") {
          return { data: { ok: true, financial_effect: false, status: "processing" }, error: null };
        }
        return { data: { ok: true, financial_effect: true, status: "refunded" }, error: null };
      },
    } as unknown as SupabaseClient<Database>;
    const rejected = await completePersistedSandboxRefund({
      admin,
      refundRequestId: REQUEST_ID,
      actorUserId: OWNER,
      providerRefundId: "mp_ref_live",
      amount: "100.00",
      currency: "BRL",
    });
    expect(rejected).toEqual({ ok: false, error: "untrusted_provider_refund_id", financial_effect: false });
    expect(calls).toEqual([]);
    const refused = await completePersistedSandboxRefund({
      admin,
      refundRequestId: REQUEST_ID,
      actorUserId: OWNER,
      providerRefundId: SANDBOX_ID,
      amount: "100.00",
      currency: "BRL",
    });
    expect(refused).toMatchObject({ ok: false, error: "financial_effect_refused", financial_effect: false });
    expect(calls).toEqual(["complete_sandbox_refund"]);
    const dispatched = await dispatchPersistedSandboxRefund({
      admin,
      refundRequestId: REQUEST_ID,
      actorUserId: OWNER,
    });
    expect(dispatched.financial_effect).toBe(false);
  });
});

describe("existing dry-run remains unchanged", () => {
  it("still simulates processing without a provider id or a financial effect", async () => {
    const result = await processMercadoPagoRefund({
      actorUserId: OWNER,
      request: { id: REQUEST_ID, status: "approved", mpPaymentId: "910735180001", ownerUserId: OWNER },
      payment: {
        mpPaymentId: "910735180001",
        ownerUserId: OWNER,
        currency: "BRL",
        amount: "100.00",
        provider: "mercadopago",
        status: "approved",
      },
      adapter: dryRunMercadoPagoRefundAdapter,
      attempts: createMemoryRefundAttemptStore(),
    });
    expect(result).toMatchObject({
      ok: true,
      status: "processing_simulated",
      financialEffect: false,
      providerRefundId: null,
      providerRefundStatus: "not_sent",
      refundRequestStatus: "approved",
    });
  });
});

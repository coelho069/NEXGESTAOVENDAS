import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assessCheckoutProRefundLinkage,
  refundIdempotencyKey,
  type MercadoPagoRefundAdapter,
  type NormalizedRefundResponse,
  type PersistedCheckoutPayment,
  type RefundProcessingRequest,
} from "@/lib/domain/mercadopago-refund";
import {
  createMercadoPagoRefundAdapter,
  dryRunMercadoPagoRefundAdapter,
} from "@/lib/domain/mercadopago-refund-adapter";
import {
  createMemoryRefundAttemptStore,
  processMercadoPagoRefund,
  type RefundAttemptStore,
} from "@/lib/domain/mercadopago-refund-processing";
import { dispatchMercadoPagoRefund } from "@/lib/domain/refund-request";

const OWNER = "user-a";
const OTHER = "user-b";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_REQUEST = "22222222-2222-4222-8222-222222222222";

function payment(overrides: Partial<PersistedCheckoutPayment> = {}): PersistedCheckoutPayment {
  return {
    mpPaymentId: "910735180001",
    ownerUserId: OWNER,
    currency: "BRL",
    amount: "100.00",
    provider: "mercadopago",
    status: "approved",
    ...overrides,
  };
}

function request(overrides: Partial<RefundProcessingRequest> = {}): RefundProcessingRequest {
  return {
    id: REQUEST_ID,
    status: "approved",
    mpPaymentId: "910735180001",
    ownerUserId: OWNER,
    ...overrides,
  };
}

function countingAdapter(execute: MercadoPagoRefundAdapter["executeRefund"]): {
  adapter: MercadoPagoRefundAdapter;
  calls: () => number;
} {
  let count = 0;
  return {
    calls: () => count,
    adapter: {
      ...dryRunMercadoPagoRefundAdapter,
      async executeRefund(built) {
        count += 1;
        return execute(built);
      },
    },
  };
}

async function run(
  overrides: Partial<Parameters<typeof processMercadoPagoRefund>[0]> = {},
  store: RefundAttemptStore = createMemoryRefundAttemptStore()
) {
  return processMercadoPagoRefund({
    actorUserId: OWNER,
    request: request(),
    payment: payment(),
    adapter: dryRunMercadoPagoRefundAdapter,
    attempts: store,
    ...overrides,
  });
}

describe("checkout linkage", () => {
  it("links the public payment id to the onboarding user and refuses a missing paid amount", () => {
    expect(
      assessCheckoutProRefundLinkage({
        mpPaymentId: "910735180001",
        onboardingUserId: OWNER,
        mpPaymentStatus: "approved",
        transactionAmount: null,
        currency: "BRL",
      })
    ).toEqual({ ok: false, error: "paid_amount_unavailable" });
  });

  it("accepts only an exact server-side BRL snapshot", () => {
    const linked = assessCheckoutProRefundLinkage({
      mpPaymentId: "910735180001",
      onboardingUserId: OWNER,
      mpPaymentStatus: "approved",
      transactionAmount: "100.00",
      currency: "BRL",
    });
    expect(linked.ok).toBe(true);
    expect(
      assessCheckoutProRefundLinkage({
        mpPaymentId: null,
        onboardingUserId: OWNER,
        mpPaymentStatus: "approved",
        transactionAmount: "100.00",
        currency: "BRL",
      }).ok
    ).toBe(false);
  });
});

describe("dry-run processing", () => {
  it("lets an approved request enter dry-run without a provider id or refunded settlement", async () => {
    const result = await run();
    expect(result).toMatchObject({
      ok: true,
      status: "processing_simulated",
      financialEffect: false,
      providerRefundId: null,
      providerRefundStatus: "not_sent",
      refundRequestStatus: "approved",
      idempotencyKey: refundIdempotencyKey(REQUEST_ID),
    });
    if (result.ok) {
      expect(result.audits.map((event) => event.event)).toEqual([
        "refund_processing_started",
        "refund_processing_dry_run",
      ]);
    }
  });

  it.each([
    ["submitted", "requested"],
    ["rejected", "rejected"],
    ["withdrawn", "cancelled"],
    ["in_review", "under review"],
  ] as const)("does not process a %s request (%s)", async (status, label) => {
    expect(label.length).toBeGreaterThan(0);
    const result = await run({ request: request({ status }) });
    expect(result).toMatchObject({ ok: false, error: "not_approved", financialEffect: false });
  });

  it("ignores a forged payer email when the signed-in client owns the payment", async () => {
    const result = await run({ untrusted: { payerEmail: "attacker@gmail.com" } });
    expect(result).toMatchObject({ ok: true, status: "processing_simulated", providerRefundId: null });
  });

  it("blocks client A from processing client B and ignores a forged payer email", async () => {
    const result = await run({
      actorUserId: OWNER,
      request: request({ ownerUserId: OTHER }),
      payment: payment({ ownerUserId: OTHER }),
      untrusted: { payerEmail: "owner-a@gmail.com" },
    });
    expect(result).toMatchObject({ ok: false, error: "not_owner", providerRefundId: null });
  });

  it("fails a payment id that belongs to someone else or does not exist", async () => {
    expect(await run({ payment: payment({ ownerUserId: OTHER, mpPaymentId: "910735180099" }), request: request({ mpPaymentId: "910735180099" }) })).toMatchObject({
      ok: false,
      error: "not_owner",
    });
    expect(await run({ payment: null })).toMatchObject({ ok: false, error: "payment_not_found" });
  });

  it("rejects manipulated, negative, oversized, and non-BRL amounts without rounding", async () => {
    expect(await run({ untrusted: { amount: "10.00" } })).toMatchObject({ ok: false, error: "client_amount_rejected" });
    expect(await run({ untrusted: { approvedAmount: "-1.00" } })).toMatchObject({ ok: false, error: "negative_amount" });
    expect(await run({ untrusted: { approvedAmount: "100.01" } })).toMatchObject({ ok: false, error: "amount_exceeds_paid" });
    expect(await run({ untrusted: { approvedAmount: "100.009" } })).toMatchObject({ ok: false, error: "client_amount_rejected" });
    expect(await run({ payment: payment({ currency: "USD" }) })).toMatchObject({ ok: false, error: "invalid_currency" });
    expect(await run({ payment: payment({ amount: "100.009" }) })).toMatchObject({ ok: false, error: "invalid_amount" });
    expect(await run({ untrusted: { provider: "stripe" } })).toMatchObject({ ok: false, error: "client_provider_rejected" });
    expect(await run({ untrusted: { providerRefundId: "forged" } })).toMatchObject({
      ok: false,
      error: "client_provider_refund_id_rejected",
    });
  });

  it("replays the same idempotency key and blocks a second request for the payment", async () => {
    const store = createMemoryRefundAttemptStore();
    const counted = countingAdapter((built) => dryRunMercadoPagoRefundAdapter.executeRefund(built));
    const first = await run({ attempts: store, adapter: counted.adapter });
    const second = await run({ attempts: store, adapter: counted.adapter });
    const other = await run({
      attempts: store,
      adapter: counted.adapter,
      request: request({ id: OTHER_REQUEST }),
    });
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(second).toMatchObject({
      ok: true,
      replayed: true,
      status: "processing_simulated",
      idempotencyKey: refundIdempotencyKey(REQUEST_ID),
      providerRefundId: null,
    });
    expect(other).toMatchObject({ ok: false, error: "duplicate_payment_refund" });
    expect(counted.calls()).toBe(1);
  });

  it("lets only one of two concurrent attempts acquire processing", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const counted = countingAdapter(async (built) => {
      await gate;
      return dryRunMercadoPagoRefundAdapter.executeRefund(built);
    });
    const store = createMemoryRefundAttemptStore();
    const first = run({ attempts: store, adapter: counted.adapter });
    const second = run({ attempts: store, adapter: counted.adapter });
    await vi.waitFor(() => expect(counted.calls()).toBe(1));
    release?.();
    const results = await Promise.all([first, second]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results).toContainEqual(expect.objectContaining({ ok: false, error: "processing_in_progress" }));
    expect(counted.calls()).toBe(1);
  });

  it("does not call the financial API", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled"));
    expect(() => createMercadoPagoRefundAdapter("live")).toThrow("provider_refund_not_enabled");
    const source = [
      "src/lib/domain/mercadopago-refund.ts",
      "src/lib/domain/mercadopago-refund-adapter.ts",
      "src/lib/domain/mercadopago-refund-processing.ts",
    ]
      .map((file) => readFileSync(join(process.cwd(), file), "utf8"))
      .join("\n");
    expect(source).not.toContain("api.mercadopago.com");
    expect(source).not.toContain("fetch(");
    expect(dispatchMercadoPagoRefund()).toEqual({ ok: false, error: "provider_refund_not_enabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("provider confirmation mock", () => {
  function mockAdapter(response: NormalizedRefundResponse | Error): MercadoPagoRefundAdapter {
    return {
      ...dryRunMercadoPagoRefundAdapter,
      async executeRefund() {
        if (response instanceof Error) throw response;
        return response;
      },
      normalizeRefundResponse(raw) {
        return raw && typeof raw === "object" ? (raw as NormalizedRefundResponse) : null;
      },
    };
  }

  it("marks refunded only when the mock provider confirms an id", async () => {
    const result = await run({
      adapter: mockAdapter({
        mode: "provider_confirmed",
        status: "refunded",
        financialEffect: true,
        providerRefundId: "mp_ref_1",
        providerRefundStatus: "not_sent",
        failure: null,
      }),
    });
    expect(result).toMatchObject({
      ok: true,
      status: "refunded",
      providerRefundId: "mp_ref_1",
      financialEffect: true,
      providerRefundStatus: "not_sent",
      refundRequestStatus: "approved",
    });
  });

  it("does not mark refunded on a provider error", async () => {
    const result = await run({
      adapter: mockAdapter({
        mode: "provider_failed",
        status: "failed",
        financialEffect: false,
        providerRefundId: null,
        providerRefundStatus: "not_sent",
        failure: "provider_error",
      }),
    });
    expect(result).toMatchObject({ ok: false, error: "provider_error", providerRefundId: null });
  });

  it("does not automatically retry a timeout, and a safe retry keeps the same key", async () => {
    const store = createMemoryRefundAttemptStore();
    let calls = 0;
    const adapter = mockAdapter(new Error("provider timeout"));
    const original = adapter.executeRefund.bind(adapter);
    adapter.executeRefund = async (built) => {
      calls += 1;
      return original(built);
    };
    const first = await run({ attempts: store, adapter });
    const automatic = await run({ attempts: store, adapter });
    const retried = await run({ attempts: store, adapter: dryRunMercadoPagoRefundAdapter, retry: true });
    expect(first).toMatchObject({ ok: false, error: "provider_timeout" });
    expect(automatic).toMatchObject({ ok: false, error: "provider_timeout", idempotencyKey: refundIdempotencyKey(REQUEST_ID) });
    expect(retried).toMatchObject({
      ok: true,
      status: "processing_simulated",
      idempotencyKey: refundIdempotencyKey(REQUEST_ID),
      providerRefundId: null,
    });
    expect(calls).toBe(1);
  });
});

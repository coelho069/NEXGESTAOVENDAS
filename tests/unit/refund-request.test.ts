import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addCalendarDays,
  assessRefundWindow,
  decideRefundReview,
  dispatchMercadoPagoRefund,
  planMercadoPagoRefund,
  refundRequestFingerprint,
  saoPauloDateIso,
} from "@/lib/domain/refund-request";
import {
  createRefundRequest,
  reviewRefundRequest,
  type RefundRequestRow,
  type RefundRequestStore,
} from "@/lib/server/refund-requests";

const baseInput = {
  clientMutationId: "11111111-1111-4111-8111-111111111111",
  payerEmail: "Cliente@Example.com",
  mpPaymentId: "123456789",
  reason: "arrependimento" as const,
  notes: "",
  intensiveUseDeclared: false,
  paidOn: "2026-10-01",
};

function row(overrides: Partial<RefundRequestRow> = {}): RefundRequestRow {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    client_mutation_id: baseInput.clientMutationId,
    mp_payment_id: baseInput.mpPaymentId,
    payer_email: "cliente@example.com",
    reason: "arrependimento",
    notes: "",
    intensive_use_declared: false,
    paid_on: "2026-10-01",
    window_assessment: "within_window",
    status: "submitted",
    request_fingerprint: refundRequestFingerprint(baseInput),
    resolution_note: null,
    reviewed_by: null,
    reviewed_at: null,
    checkout_session_id: null,
    payer_email_matches_checkout: null,
    provider: "mercadopago",
    provider_refund_status: "not_sent",
    created_at: "2026-10-06T12:00:00.000Z",
    updated_at: "2026-10-06T12:00:00.000Z",
    ...overrides,
  };
}

function memoryStore(initial: RefundRequestRow[] = []): RefundRequestStore & { rows: RefundRequestRow[] } {
  const rows = [...initial];
  return {
    rows,
    async findByMutationId(clientMutationId) {
      return rows.find((item) => item.client_mutation_id === clientMutationId) ?? null;
    },
    async findById(id) {
      return rows.find((item) => item.id === id) ?? null;
    },
    async insert(input) {
      if (rows.some((item) => item.client_mutation_id === input.client_mutation_id)) {
        return { error: { code: "23505", message: "duplicate key value violates refund_requests_client_mutation_id_key" } };
      }
      if (
        rows.some(
          (item) =>
            item.mp_payment_id === input.mp_payment_id &&
            (item.status === "submitted" || item.status === "in_review")
        )
      ) {
        return { error: { code: "23505", message: "duplicate key value violates refund_requests_open_payment_uidx" } };
      }
      rows.push(row({ ...input, payer_email: input.payer_email }));
      return { error: null };
    },
    async findCheckout() {
      return null;
    },
    async updateIfStatus(id, expectedStatus, patch) {
      const current = rows.find((item) => item.id === id && item.status === expectedStatus);
      if (!current) return null;
      Object.assign(current, patch);
      return current;
    },
    async listRecent() {
      return rows;
    },
    async cancelSubscriptionForPayment() {
      return "none";
    },
  };
}

describe("refund request domain", () => {
  it("counts seven calendar days in America/Sao_Paulo", () => {
    expect(saoPauloDateIso(new Date("2026-10-06T02:30:00.000Z"))).toBe("2026-10-05");
    expect(addCalendarDays("2026-10-01", 7)).toBe("2026-10-08");
    expect(
      assessRefundWindow({ paidOn: "2026-10-01", todayIso: "2026-10-08", windowDays: 7 })
    ).toBe("within_window");
    expect(
      assessRefundWindow({ paidOn: "2026-10-01", todayIso: "2026-10-09", windowDays: 7 })
    ).toBe("outside_window");
    expect(assessRefundWindow({ paidOn: null, todayIso: "2026-10-06", windowDays: 7 })).toBe("unknown");
  });

  it("allows only the analysis transitions and blocks an outside-window approval without acknowledgement", () => {
    expect(
      decideRefundReview({
        status: "submitted",
        action: "approve",
        windowAssessment: "within_window",
        resolutionNote: "",
        acknowledgeOutsideWindow: false,
      })
    ).toEqual({ ok: false, error: "invalid_transition" });
    expect(
      decideRefundReview({
        status: "submitted",
        action: "start_review",
        windowAssessment: "within_window",
        resolutionNote: "",
        acknowledgeOutsideWindow: false,
      }).ok
    ).toBe(true);
    expect(
      decideRefundReview({
        status: "in_review",
        action: "approve",
        windowAssessment: "outside_window",
        resolutionNote: "",
        acknowledgeOutsideWindow: false,
      })
    ).toEqual({ ok: false, error: "outside_window_unacknowledged" });
    expect(
      decideRefundReview({
        status: "approved",
        action: "reject",
        windowAssessment: "within_window",
        resolutionNote: "tarde",
        acknowledgeOutsideWindow: false,
      })
    ).toEqual({ ok: false, error: "refund_request_terminal" });
  });

  it("plans a Mercado Pago refund intent and refuses to dispatch it", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(planMercadoPagoRefund("123456789")).toEqual({
      provider: "mercadopago",
      mpPaymentId: "123456789",
      dispatch: "not_sent",
    });
    expect(dispatchMercadoPagoRefund()).toEqual({
      ok: false,
      error: "provider_refund_not_enabled",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("refund request store workflow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("replays the same mutation id and rejects a second open request for the payment", async () => {
    const store = memoryStore();
    const now = new Date("2026-10-06T15:00:00.000Z");
    const created = await createRefundRequest(store, baseInput, now);
    expect(created).toMatchObject({ ok: true, replayed: false, status: "submitted" });
    const replay = await createRefundRequest(store, baseInput, now);
    expect(replay).toMatchObject({ ok: true, replayed: true });
    const mismatch = await createRefundRequest(
      store,
      { ...baseInput, notes: "outro texto" },
      now
    );
    expect(mismatch).toMatchObject({ ok: false, error: "idempotency_payload_mismatch", status: 409 });
    const second = await createRefundRequest(
      store,
      { ...baseInput, clientMutationId: "33333333-3333-4333-8333-333333333333" },
      now
    );
    expect(second).toMatchObject({ ok: false, error: "open_refund_request_exists", status: 409 });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.provider_refund_status).toBe("not_sent");
  });

  it("recomputes an expired window at review even when the stored assessment is within_window", async () => {
    const store = memoryStore([row({ status: "in_review", window_assessment: "within_window" })]);
    store.findCheckout = async () => ({
      id: "11111111-1111-4111-8111-111111111111",
      payer_email: "cliente@example.com",
      mp_payment_paid_at: "2026-09-01T15:00:00.000Z",
    });
    const result = await reviewRefundRequest(store, {
      id: row().id,
      action: "approve",
      resolutionNote: "",
      acknowledgeOutsideWindow: false,
      reviewerId: "44444444-4444-4444-8444-444444444444",
      now: new Date("2026-10-08T15:00:00.000Z"),
    });
    expect(result).toEqual({ ok: false, error: "outside_window_unacknowledged" });
    expect(store.rows[0]?.provider_refund_status).toBe("not_sent");
  });

  it("approve keeps the row pending when Mercado Pago fails", async () => {
    const store = memoryStore([row({ status: "in_review" })]);
    const calls: Array<{ mpPaymentId: string; idempotencyKey: string }> = [];
    const result = await reviewRefundRequest(store, {
      id: row().id,
      action: "approve",
      resolutionNote: "",
      acknowledgeOutsideWindow: false,
      reviewerId: "44444444-4444-4444-8444-444444444444",
      now: new Date("2026-10-06T15:00:00.000Z"),
      refundExecutor: async (input) => {
        calls.push(input);
        return { ok: false, error: "mp_refund_failed", message: "Saldo insuficiente." };
      },
    });
    expect(result).toEqual({ ok: false, error: "mp_refund_failed", message: "Saldo insuficiente." });
    expect(calls[0]?.idempotencyKey).toBe(`mercadopago:refund:${row().id}`);
    expect(store.rows[0]?.status).toBe("in_review");
    expect(store.rows[0]?.provider_refund_status).toBe("not_sent");
  });

  it("approve records the Mercado Pago refund only after confirmation", async () => {
    const store = memoryStore([row({ status: "in_review" })]);
    const result = await reviewRefundRequest(store, {
      id: row().id,
      action: "approve",
      resolutionNote: "",
      acknowledgeOutsideWindow: false,
      reviewerId: "44444444-4444-4444-8444-444444444444",
      now: new Date("2026-10-06T15:00:00.000Z"),
      refundExecutor: async () => ({ ok: true, refundId: "123456789", status: "approved", alreadyRefunded: false }),
    });
    expect(result).toEqual({ ok: true, id: row().id, status: "refunded" });
    expect(store.rows[0]?.provider_refund_status).toBe("completed");
    expect(store.rows[0]?.provider_refund_id).toBe("123456789");
  });

  it("approve cancels the subscription tied to the refunded payment", async () => {
    const store = memoryStore([row({ status: "in_review" })]);
    const cancelSubscriptionForPayment = vi.fn(async () => "canceled" as const);
    store.cancelSubscriptionForPayment = cancelSubscriptionForPayment;
    const result = await reviewRefundRequest(store, {
      id: row().id,
      action: "approve",
      resolutionNote: "",
      acknowledgeOutsideWindow: false,
      reviewerId: "44444444-4444-4444-8444-444444444444",
      now: new Date("2026-10-06T15:00:00.000Z"),
      refundExecutor: async () => ({ ok: true, refundId: "123456789", status: "approved", alreadyRefunded: false }),
    });
    expect(result).toEqual({ ok: true, id: row().id, status: "refunded" });
    expect(cancelSubscriptionForPayment).toHaveBeenCalledWith(baseInput.mpPaymentId, "2026-10-06T15:00:00.000Z");
  });

  it("approve still returns refunded when subscription cancel fails", async () => {
    const store = memoryStore([row({ status: "in_review" })]);
    store.cancelSubscriptionForPayment = vi.fn(async () => {
      throw new Error("subscription_update_failed");
    });
    const result = await reviewRefundRequest(store, {
      id: row().id,
      action: "approve",
      resolutionNote: "",
      acknowledgeOutsideWindow: false,
      reviewerId: "44444444-4444-4444-8444-444444444444",
      now: new Date("2026-10-06T15:00:00.000Z"),
      refundExecutor: async () => ({ ok: true, refundId: "123456789", status: "approved", alreadyRefunded: false }),
    });
    expect(result).toEqual({ ok: true, id: row().id, status: "refunded" });
    expect(store.rows[0]?.status).toBe("refunded");
    expect(store.rows[0]?.provider_refund_status).toBe("completed");
  });
});

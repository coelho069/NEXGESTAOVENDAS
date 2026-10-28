import { describe, expect, it, vi } from "vitest";
import { refundRequestFingerprint } from "@/lib/domain/refund-request";
import {
  reviewRefundRequest,
  type RefundExecutor,
  type RefundRequestRow,
  type RefundRequestStore,
} from "@/lib/server/refund-requests";

// Regressão B1: o claim condicional (in_review -> approved + processing) deve acontecer
// ANTES de qualquer chamada ao Mercado Pago. Provedor simulado, sem rede e sem credenciais.

const ID = "22222222-2222-4222-8222-222222222222";
const REVIEWER = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-10-06T15:00:00.000Z");

const base = {
  payerEmail: "cliente@example.com",
  mpPaymentId: "123456789",
  reason: "arrependimento" as const,
  notes: "",
  intensiveUseDeclared: false,
  paidOn: "2026-10-01",
};

function makeRow(overrides: Partial<RefundRequestRow> = {}): RefundRequestRow {
  return {
    id: ID,
    client_mutation_id: "11111111-1111-4111-8111-111111111111",
    mp_payment_id: base.mpPaymentId,
    payer_email: base.payerEmail,
    reason: "arrependimento",
    notes: "",
    intensive_use_declared: false,
    paid_on: base.paidOn,
    window_assessment: "within_window",
    status: "in_review",
    request_fingerprint: refundRequestFingerprint(base),
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

type Hooks = {
  /** Runs inside findCheckout, that is, after the review read the status and before the claim. */
  beforeClaim?: (rows: RefundRequestRow[]) => void;
  /** Number of updateIfStatus calls that throw, counted from the first call that matches patch.processing_state or patch.provider_refund_id. */
  failRecordWrites?: number;
  /** Makes the claim throw (for example, unique index on payment). */
  failClaim?: boolean;
};

function makeStore(initial: RefundRequestRow[], hooks: Hooks = {}) {
  const rows = initial.map((item) => ({ ...item }));
  let recordFailuresLeft = hooks.failRecordWrites ?? 0;
  const store: RefundRequestStore & { rows: RefundRequestRow[] } = {
    rows,
    async findByMutationId() {
      return null;
    },
    async findById(id) {
      const found = rows.find((item) => item.id === id);
      return found ? { ...found } : null;
    },
    async insert() {
      return { error: null };
    },
    async findCheckout() {
      hooks.beforeClaim?.(rows);
      return null;
    },
    async updateIfStatus(id, expectedStatus, patch) {
      const isClaim = patch.processing_state === "processing";
      if (isClaim && hooks.failClaim) throw new Error("refund_request_update_failed");
      const isRecord = patch.provider_refund_id !== undefined;
      if (isRecord && recordFailuresLeft > 0) {
        recordFailuresLeft -= 1;
        throw new Error("refund_request_update_failed");
      }
      const current = rows.find((item) => item.id === id && item.status === expectedStatus);
      if (!current) return null;
      Object.assign(current, patch);
      return { ...current };
    },
    async listRecent() {
      return rows;
    },
  };
  return store;
}

function approve(store: RefundRequestStore, executor: RefundExecutor) {
  return reviewRefundRequest(store, {
    id: ID,
    action: "approve",
    resolutionNote: "",
    acknowledgeOutsideWindow: false,
    reviewerId: REVIEWER,
    now: NOW,
    refundExecutor: executor,
  });
}

const okRefund: RefundExecutor = async () => ({
  ok: true,
  refundId: "900000001",
  status: "approved",
  alreadyRefunded: false,
});

describe("B1 refund claim before external effect", () => {
  it("claims before calling the provider and records the refund id on success", async () => {
    const store = makeStore([makeRow()]);
    const seenAtCall: Array<{ status: string; processing_state: unknown; key: unknown }> = [];
    const executor = vi.fn<RefundExecutor>(async (input) => {
      const current = store.rows[0]!;
      seenAtCall.push({ status: current.status, processing_state: current.processing_state, key: current.idempotency_key });
      expect(input.idempotencyKey).toBe(`mercadopago:refund:${ID}`);
      return okRefund(input);
    });
    const result = await approve(store, executor);
    expect(result).toEqual({ ok: true, id: ID, status: "refunded" });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(seenAtCall[0]).toEqual({
      status: "approved",
      processing_state: "processing",
      key: `mercadopago:refund:${ID}`,
    });
    expect(store.rows[0]?.provider_refund_id).toBe("900000001");
    expect(store.rows[0]?.provider_refund_status).toBe("completed");
  });

  it("does not call the provider when the claim is not acquired (reject won the race)", async () => {
    const store = makeStore([makeRow()], {
      beforeClaim: (rows) => {
        rows[0]!.status = "rejected";
      },
    });
    const executor = vi.fn<RefundExecutor>(okRefund);
    const result = await approve(store, executor);
    expect(result).toEqual({ ok: false, error: "refund_request_conflict" });
    expect(executor).not.toHaveBeenCalled();
    expect(store.rows[0]?.status).toBe("rejected");
    expect(store.rows[0]?.processing_state ?? null).toBeNull();
  });

  it("does not call the provider when the claim write fails (for example, a payment already claimed)", async () => {
    const store = makeStore([makeRow()], { failClaim: true });
    const executor = vi.fn<RefundExecutor>(okRefund);
    const result = await approve(store, executor);
    expect(result).toEqual({ ok: false, error: "unavailable" });
    expect(executor).not.toHaveBeenCalled();
    expect(store.rows[0]?.status).toBe("in_review");
  });

  it("two concurrent approvals run the refund only once", async () => {
    const store = makeStore([makeRow()]);
    const executor = vi.fn<RefundExecutor>(async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return okRefund(input);
    });
    const [first, second] = await Promise.all([approve(store, executor), approve(store, executor)]);
    expect(executor).toHaveBeenCalledTimes(1);
    const results = [first, second];
    expect(results.filter((item) => item.ok)).toHaveLength(1);
    expect(results.filter((item) => !item.ok)).toEqual([{ ok: false, error: "refund_request_conflict" }]);
    expect(store.rows[0]?.status).toBe("refunded");
  });

  it("a provider refusal before acceptance records a failed claim and never releases to in_review", async () => {
    const store = makeStore([makeRow()]);
    const executor = vi.fn<RefundExecutor>(async () => ({
      ok: false,
      error: "mp_refund_failed",
      message: "Saldo insuficiente.",
      providerRejected: true,
    }));
    const result = await approve(store, executor);
    expect(result).toEqual({ ok: false, error: "mp_refund_failed", message: "Saldo insuficiente." });
    expect(store.rows[0]?.status).toBe("approved");
    expect(store.rows[0]?.processing_state).toBe("failed");
    expect(store.rows[0]?.provider_refund_id ?? null).toBeNull();
    // A failed refund can be retried by admin approval.
    const again = vi.fn<RefundExecutor>(okRefund);
    expect(await approve(store, again)).toEqual({ ok: true, id: ID, status: "refunded" });
    expect(again).toHaveBeenCalledTimes(1);
    expect(store.rows[0]?.status).toBe("refunded");
  });

  it("a timeout is an unknown outcome: the claim stays, goes to reconciliation, and is never resent", async () => {
    const store = makeStore([makeRow()]);
    const executor = vi.fn<RefundExecutor>(async () => ({ ok: false, error: "mp_refund_timeout" }));
    const result = await approve(store, executor);
    expect(result).toMatchObject({ ok: false, error: "mp_refund_outcome_unknown" });
    expect(store.rows[0]).toMatchObject({
      status: "processing",
      provider_refund_status: "processing",
      processing_state: "unknown",
      processing_error_class: "timeout",
      last_processing_error: "mp_refund_timeout",
    });
    expect(executor).toHaveBeenCalledTimes(1);
    // The existing guard (provider_refund_status already recorded) blocks any new attempt.
    const again = vi.fn<RefundExecutor>(okRefund);
    expect(await approve(store, again)).toEqual({ ok: false, error: "provider_refund_already_recorded" });
    expect(again).not.toHaveBeenCalled();
  });

  it("an executor exception is an unknown outcome, not a release", async () => {
    const store = makeStore([makeRow()]);
    const result = await approve(store, async () => {
      throw new Error("socket hang up");
    });
    expect(result).toMatchObject({ ok: false, error: "mp_refund_outcome_unknown" });
    expect(store.rows[0]?.status).toBe("processing");
    expect(store.rows[0]?.processing_state).toBe("unknown");
  });

  it("an unrefused mp_refund_failed (no providerRejected flag) is treated as unknown", async () => {
    const store = makeStore([makeRow()]);
    const result = await approve(store, async () => ({
      ok: false,
      error: "mp_refund_failed",
      message: "Falha ao falar com o Mercado Pago.",
    }));
    expect(result).toMatchObject({ ok: false, error: "mp_refund_outcome_unknown" });
    expect(store.rows[0]?.processing_state).toBe("unknown");
  });

  it("a success whose record write fails is retried and does not resend the refund", async () => {
    const store = makeStore([makeRow()], { failRecordWrites: 2 });
    const executor = vi.fn<RefundExecutor>(okRefund);
    const result = await approve(store, executor);
    expect(result).toEqual({ ok: true, id: ID, status: "refunded" });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(store.rows[0]?.provider_refund_id).toBe("900000001");
  });

  it("a success that cannot be recorded returns a reconciliation error and does not resend", async () => {
    const store = makeStore([makeRow()], { failRecordWrites: 99 });
    const executor = vi.fn<RefundExecutor>(okRefund);
    const result = await approve(store, executor);
    expect(result).toMatchObject({ ok: false, error: "refund_record_pending_reconciliation" });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(store.rows[0]?.status).toBe("approved");
    expect(store.rows[0]?.processing_state).toBe("processing");
    expect(store.rows[0]?.provider_refund_id ?? null).toBeNull();
  });
});

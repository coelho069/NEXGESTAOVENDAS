import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  confirmedSnapshotFromPayment,
  exactConfirmedMoney,
} from "@/lib/domain/checkout-payment-snapshot";
import { parseMercadoPagoCheckoutProPaymentResponse } from "@/lib/domain/mercadopago-checkout-pro";
import {
  assessCheckoutProRefundLinkage,
  persistedRefundAmount,
  rejectUntrustedRefundCommand,
} from "@/lib/domain/mercadopago-refund";
import { dispatchMercadoPagoRefund } from "@/lib/domain/refund-request";
import { createOwnedRefundRequestSchema } from "@/lib/validation/schemas";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261006183000_checkout_payment_snapshot_and_refund_claim.sql"),
  "utf8"
);
const rollback = readFileSync(
  join(process.cwd(), "supabase/rollbacks/20261006183000_checkout_payment_snapshot_and_refund_claim.sql"),
  "utf8"
);
const claimSource = readFileSync(
  join(process.cwd(), "src/lib/server/refund-processing-claim.ts"),
  "utf8"
);
const adapterSource = readFileSync(
  join(process.cwd(), "src/lib/domain/mercadopago-refund-adapter.ts"),
  "utf8"
);

describe("confirmed payment snapshot", () => {
  it("keeps an exact provider amount and rejects a value that would be rounded", () => {
    expect(exactConfirmedMoney(79.9)).toBe("79.90");
    expect(exactConfirmedMoney("79.90")).toBe("79.90");
    expect(exactConfirmedMoney("79.9")).toBe("79.90");
    expect(exactConfirmedMoney(79.999)).toBeNull();
    expect(exactConfirmedMoney("79.999")).toBeNull();
    expect(exactConfirmedMoney(-1)).toBeNull();
    expect(exactConfirmedMoney("0.00")).toBeNull();
  });

  it("reads amount, currency, and confirmation time from the provider payment", () => {
    const parsed = parseMercadoPagoCheckoutProPaymentResponse({
      id: 123456789,
      status: "approved",
      transaction_amount: 79.9,
      currency_id: "brl",
      date_approved: "2026-10-06T12:04:05.000-03:00",
      external_reference: "22222222-2222-4222-8222-222222222222",
    });
    expect(parsed?.transactionAmount).toBe("79.90");
    expect(confirmedSnapshotFromPayment(parsed!)).toEqual({
      transactionAmount: "79.90",
      transactionCurrency: "BRL",
      transactionPaidAt: "2026-10-06T15:04:05.000Z",
    });
  });

  it("does not build a snapshot when the provider omits the confirmation", () => {
    const parsed = parseMercadoPagoCheckoutProPaymentResponse({
      id: "123456789",
      status: "approved",
      transaction_amount: "79.90",
      currency_id: "BRL",
    });
    expect(confirmedSnapshotFromPayment(parsed!)).toBeNull();
  });
});

describe("refund amount uses only the persisted snapshot", () => {
  it("returns paid_amount_unavailable when the snapshot is missing even if the plan price exists", () => {
    expect(
      persistedRefundAmount(
        { transactionAmount: null, transactionCurrency: "BRL" },
        { planAmount: "79.90", contractedAmount: "79.90" }
      )
    ).toEqual({ ok: false, error: "paid_amount_unavailable" });
  });

  it("keeps the snapshot amount when the plan and the contract change later", () => {
    const priced = persistedRefundAmount(
      { transactionAmount: "80.00", transactionCurrency: "BRL" },
      { planAmount: "10.00", contractedAmount: "999.99" }
    );
    expect(priced).toEqual({ ok: true, amount: "80.00", currency: "BRL" });
    const linked = assessCheckoutProRefundLinkage({
      mpPaymentId: "910583210001",
      onboardingUserId: "user-a",
      mpPaymentStatus: "approved",
      transactionAmount: "80.00",
      currency: "BRL",
      planAmount: "10.00",
      contractedAmount: "999.99",
    });
    expect(linked).toMatchObject({ ok: true, payment: { amount: "80.00", currency: "BRL" } });
  });

  it("rejects a non-BRL snapshot and does not fall back to the plan currency", () => {
    expect(
      persistedRefundAmount(
        { transactionAmount: "80.00", transactionCurrency: "USD" },
        { planAmount: "80.00" }
      )
    ).toEqual({ ok: false, error: "invalid_currency" });
  });

  it("ignores snapshot fields sent by the browser", () => {
    const parsed = createOwnedRefundRequestSchema.safeParse({
      client_mutation_id: "44444444-4444-4444-8444-444444444444",
      mp_payment_id: "123456789",
      reason: "arrependimento",
      notes: "",
      confirmed: true,
      transaction_amount: "1.00",
      currency: "USD",
      transaction_paid_at: "2026-10-06T00:00:00.000Z",
      idempotency_key: "client-key",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).not.toHaveProperty("transaction_amount");
    expect(parsed.data).not.toHaveProperty("currency");
    expect(parsed.data).not.toHaveProperty("idempotency_key");
    expect(rejectUntrustedRefundCommand({ transactionAmount: "1.00" }, "80.00")).toBe(
      "client_transaction_amount_rejected"
    );
    expect(rejectUntrustedRefundCommand({ currency: "USD" }, "80.00")).toBe("invalid_currency");
    expect(rejectUntrustedRefundCommand({ currency: "BRL" }, "80.00")).toBe("client_currency_rejected");
    expect(rejectUntrustedRefundCommand({ transactionPaidAt: "2026-10-06T00:00:00.000Z" }, "80.00")).toBe(
      "client_paid_at_rejected"
    );
    expect(rejectUntrustedRefundCommand({ idempotencyKey: "client-key" }, "80.00")).toBe(
      "client_idempotency_key_rejected"
    );
  });
});

describe("persistent claim migration", () => {
  it("defines the snapshot, the immutable trigger, and the single claim", () => {
    expect(migration).toContain("transaction_amount numeric(12,2)");
    expect(migration).toContain("transaction_currency text");
    expect(migration).toContain("transaction_paid_at timestamptz");
    expect(migration).toContain("transaction_snapshot_immutable");
    expect(migration).toContain("refund_requests_idempotency_key_uidx");
    expect(migration).toContain("refund_requests_payment_processing_uidx");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("provider_refund_status = 'not_sent'");
    expect(migration).not.toContain("api.mercadopago.com");
    expect(migration).not.toContain("api.stripe.com");
    expect(rollback).toContain("DROP FUNCTION IF EXISTS public.claim_refund_processing");
    expect(rollback).toContain("DROP COLUMN IF EXISTS transaction_amount");
  });

  it("keeps the durable claim and the live refund dispatch off the network", () => {
    expect(claimSource).toContain("claim_refund_processing");
    expect(claimSource).toContain("complete_refund_processing_dry_run");
    expect(claimSource).not.toContain("fetch(");
    expect(claimSource).not.toContain("api.mercadopago.com");
    expect(claimSource).not.toContain("api.stripe.com");
    expect(adapterSource).not.toContain("api.mercadopago.com");
    expect(adapterSource).not.toContain("fetch(");
    expect(dispatchMercadoPagoRefund()).toEqual({
      ok: false,
      error: "provider_refund_not_enabled",
    });
  });
});

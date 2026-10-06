import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseMercadoPagoCheckoutProWebhookNotification } from "@/lib/domain/mercadopago-checkout-pro";
import { dispatchMercadoPagoRefund } from "@/lib/domain/refund-request";
import { POST } from "@/app/api/subscriptions/mercadopago/public-checkout/webhook/route";
import { applyMercadoPagoCheckoutProWebhookEvent } from "@/lib/server/mercadopago-checkout-pro-webhook";

const harness = vi.hoisted(() => ({
  calls: 0,
  payments: new Map<string, { throwOnce?: boolean; payment: Record<string, unknown> }>(),
}));

vi.mock("@/lib/server/mercadopago", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/mercadopago")>();
  return {
    ...actual,
    getMercadoPagoEnv: () => ({
      configured: true,
      accessToken: "mock-token",
      webhookSecret: "mock-secret",
      timeoutMs: 1000,
    }),
  };
});

vi.mock("@/lib/server/mercadopago-checkout-pro", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/mercadopago-checkout-pro")>();
  return {
    ...actual,
    createMercadoPagoCheckoutProGateway: () => ({
      async getPayment(id: string) {
        harness.calls += 1;
        const spec = harness.payments.get(id);
        if (!spec) return null;
        if (spec.throwOnce) {
          spec.throwOnce = false;
          throw new Error("mercadopago_checkout_pro_get_payment_failed");
        }
        return spec.payment;
      },
      async getPreference() {
        return null;
      },
    }),
  };
});

vi.mock("@/lib/server/visitor-onboarding", () => ({
  runVisitorOnboarding: vi.fn(async () => ({
    status: "completed",
    subscriptionId: "synthetic-subscription",
    loginEmail: "snapshot-phase-84631@example.test",
    accessEmailSent: false,
    verifiedUserCreated: false,
  })),
}));

vi.mock("@/lib/server/telegram-notify", () => ({
  getTelegramNotifyConfig: () => ({ configured: false, reason: "test" }),
  sendTelegramMessage: vi.fn(async () => ({ ok: false, error: "not_sent" })),
}));

const SESSION = "84631000-0000-4000-8000-000000000001";
const MUTATION = "84631000-0000-4000-8000-000000000002";
const PAYMENT = "910846310001";
const RACE_SESSION = "84631000-0000-4000-8000-000000000011";
const RACE_MUTATION = "84631000-0000-4000-8000-000000000012";
const RACE_PAYMENT = "910846310002";
const RETRY_SESSION = "84631000-0000-4000-8000-000000000021";
const RETRY_MUTATION = "84631000-0000-4000-8000-000000000022";
const RETRY_PAYMENT = "910846310003";
const LOCAL_URL = "http://127.0.0.1:54321";
const APPROVED_AT = "2026-10-06T12:04:05.000-03:00";
const PROVIDER_AMOUNT = "123.45";

let admin: SupabaseClient;
let planAmount = "";
const previousEnv = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  service: process.env.SUPABASE_SERVICE_ROLE_KEY,
  checkout: process.env.MERCADOPAGO_CHECKOUT_ENABLED,
};
const originalFetch = globalThis.fetch;

function localServiceRoleKey(): string {
  const status = execFileSync("supabase", ["status", "-o", "env"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const api = status.match(/^API_URL="([^"]+)"/m)?.[1] ?? "";
  const key = status.match(/^SERVICE_ROLE_KEY="([^"]+)"/m)?.[1] ?? "";
  if (api !== LOCAL_URL || !key) {
    throw new Error("local supabase is not available");
  }
  return key;
}

function payment(input: {
  id: string;
  amount: string;
  currency?: string;
  externalReference: string;
  dateApproved?: string | null;
  status?: string;
}) {
  return {
    id: input.id,
    status: input.status ?? "approved",
    externalReference: input.externalReference,
    preferenceId: null,
    payerEmail: "snapshot-phase-84631@example.test",
    transactionAmount: input.amount,
    currencyId: input.currency ?? "BRL",
    dateApproved: input.dateApproved === undefined ? APPROVED_AT : input.dateApproved,
  };
}

function notification(id: string) {
  return {
    id: `evt-${id}`,
    type: "payment",
    action: "payment.updated",
    data: { id },
  };
}

function moneyText(value: unknown): string {
  return Number(value).toFixed(2);
}

async function readSession(id: string) {
  const { data, error } = await admin
    .from("checkout_sessions")
    .select(
      "id, mp_payment_id, transaction_amount, transaction_currency, transaction_paid_at, transaction_snapshot_conflict"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function insertSession(id: string, mutation: string, planId: string) {
  const { error } = await admin.from("checkout_sessions").insert({
    id,
    client_mutation_id: mutation,
    plan_id: planId,
    payer_email: "snapshot-phase-84631@example.test",
  });
  if (error) throw error;
}

async function removeSynthetic() {
  await admin.from("checkout_sessions").delete().in("id", [SESSION, RACE_SESSION, RETRY_SESSION]);
}

describe("local Checkout Pro snapshot webhook", () => {
  beforeAll(async () => {
    const key = localServiceRoleKey();
    process.env.NEXT_PUBLIC_SUPABASE_URL = LOCAL_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = key;
    process.env.MERCADOPAGO_CHECKOUT_ENABLED = "true";
    admin = createClient(LOCAL_URL, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes("mercadopago.com") || url.includes("api.stripe.com") || url.includes("stripe.com")) {
        throw new Error("financial_http_forbidden");
      }
      return originalFetch(input, init);
    });
    await removeSynthetic();
    const { data: plan, error } = await admin.from("plans").select("id, amount").limit(1).single();
    if (error) throw error;
    planAmount = String(plan.amount);
    await insertSession(SESSION, MUTATION, plan.id);
    await insertSession(RACE_SESSION, RACE_MUTATION, plan.id);
    await insertSession(RETRY_SESSION, RETRY_MUTATION, plan.id);
  });

  afterAll(async () => {
    if (admin) await removeSynthetic();
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousEnv.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousEnv.service;
    process.env.MERCADOPAGO_CHECKOUT_ENABLED = previousEnv.checkout;
    vi.spyOn(globalThis, "fetch").mockRestore();
  });

  it("ignores an amount carried by the webhook body and an invalid signature", async () => {
    const parsed = parseMercadoPagoCheckoutProWebhookNotification({
      id: "evt-body",
      type: "payment",
      action: "payment.updated",
      data: { id: PAYMENT },
      transaction_amount: "1.00",
      currency_id: "USD",
    });
    expect(parsed).toEqual({
      id: "evt-body",
      type: "payment",
      action: "payment.updated",
      live_mode: false,
      data: { id: PAYMENT },
    });

    const callsBefore = harness.calls;
    const response = await POST(
      new Request(`http://127.0.0.1/api/subscriptions/mercadopago/public-checkout/webhook?data.id=${PAYMENT}`, {
        method: "POST",
        headers: {
          "x-signature": "ts=1,v1=deadbeef",
          "x-request-id": "req-84631",
        },
        body: JSON.stringify({
          id: "evt-unauth",
          type: "payment",
          action: "payment.updated",
          data: { id: PAYMENT },
          transaction_amount: "1.00",
        }),
      })
    );
    expect(response.status).toBe(400);
    expect(harness.calls).toBe(callsBefore);
    expect(await readSession(SESSION)).toMatchObject({ mp_payment_id: null, transaction_amount: null });
  });

  it("rejects an invalid webhook before creating a snapshot", async () => {
    const secret = "mock-secret";
    const dataId = PAYMENT;
    const ts = "1710000000";
    const requestId = "req-invalid";
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const hash = createHmac("sha256", secret).update(manifest).digest("hex");
    const callsBefore = harness.calls;
    const response = await POST(
      new Request(`http://127.0.0.1/api/subscriptions/mercadopago/public-checkout/webhook?data.id=${dataId}`, {
        method: "POST",
        headers: {
          "x-signature": `ts=${ts},v1=${hash}`,
          "x-request-id": requestId,
        },
        body: "{",
      })
    );
    expect(response.status).toBe(400);
    expect(harness.calls).toBe(callsBefore);
  });

  it("does not snapshot a payment that has no matching checkout session", async () => {
    const before = harness.calls;
    harness.payments.set(
      "910846310099",
      { payment: payment({ id: "910846310099", amount: PROVIDER_AMOUNT, externalReference: "77777777-7777-4777-8777-777777777777" }) }
    );
    const result = await applyMercadoPagoCheckoutProWebhookEvent(notification("910846310099"));
    expect(result.ignored_reason).toBe("checkout_session_not_found");
    const { count, error } = await admin
      .from("checkout_sessions")
      .select("id", { count: "exact", head: true })
      .eq("mp_payment_id", "910846310099");
    if (error) throw error;
    expect(count).toBe(0);
    expect(harness.calls).toBe(before + 1);
  });

  it("does not snapshot a payment that the provider has not approved", async () => {
    harness.payments.set(PAYMENT, {
      payment: payment({ id: PAYMENT, amount: PROVIDER_AMOUNT, externalReference: MUTATION, status: "pending" }),
    });
    const result = await applyMercadoPagoCheckoutProWebhookEvent(notification(PAYMENT));
    expect(result.ignored_reason).toBe("payment_status_pending");
    expect(await readSession(SESSION)).toMatchObject({ mp_payment_id: null, transaction_amount: null });
  });

  it("stores the provider snapshot and keeps it idempotent across a repeated webhook", async () => {
    expect(planAmount).not.toBe("");
    harness.payments.set(PAYMENT, {
      payment: payment({ id: PAYMENT, amount: PROVIDER_AMOUNT, externalReference: MUTATION }),
    });
    const first = await applyMercadoPagoCheckoutProWebhookEvent(notification(PAYMENT));
    expect(first.replay).toBe(false);
    const stored = await readSession(SESSION);
    expect(stored).toMatchObject({
      mp_payment_id: PAYMENT,
      transaction_currency: "BRL",
      transaction_snapshot_conflict: null,
    });
    expect(moneyText(stored?.transaction_amount)).toBe(PROVIDER_AMOUNT);
    expect(Date.parse(String(stored?.transaction_paid_at))).toBe(Date.parse(APPROVED_AT));
    expect(moneyText(stored?.transaction_amount)).not.toBe(moneyText(planAmount));

    await admin.from("checkout_sessions").update({ onboarding_status: "completed" }).eq("id", SESSION);
    const paidAt = stored?.transaction_paid_at;
    const second = await applyMercadoPagoCheckoutProWebhookEvent(notification(PAYMENT));
    expect(second.replay).toBe(true);
    const replayed = await readSession(SESSION);
    expect(replayed?.transaction_paid_at).toBe(paidAt);
    expect(moneyText(replayed?.transaction_amount)).toBe(PROVIDER_AMOUNT);
    expect(replayed?.transaction_snapshot_conflict).toBeNull();
  });

  it("records an amount conflict and a currency conflict without overwriting the snapshot", async () => {
    const paidAt = (await readSession(SESSION))?.transaction_paid_at;
    harness.payments.set(PAYMENT, {
      payment: payment({ id: PAYMENT, amount: "10.00", externalReference: MUTATION }),
    });
    const amountConflict = await applyMercadoPagoCheckoutProWebhookEvent(notification(PAYMENT));
    expect(amountConflict.snapshot_conflict).toBe("amount");
    const afterAmount = await readSession(SESSION);
    expect(moneyText(afterAmount?.transaction_amount)).toBe(PROVIDER_AMOUNT);
    expect(afterAmount).toMatchObject({
      transaction_currency: "BRL",
      transaction_paid_at: paidAt,
      transaction_snapshot_conflict: "amount",
    });

    harness.payments.set(PAYMENT, {
      payment: payment({ id: PAYMENT, amount: PROVIDER_AMOUNT, currency: "USD", externalReference: MUTATION }),
    });
    const currencyConflict = await applyMercadoPagoCheckoutProWebhookEvent(notification(PAYMENT));
    expect(currencyConflict.snapshot_conflict).toBe("currency");
    const afterCurrency = await readSession(SESSION);
    expect(moneyText(afterCurrency?.transaction_amount)).toBe(PROVIDER_AMOUNT);
    expect(afterCurrency).toMatchObject({
      transaction_currency: "BRL",
      transaction_paid_at: paidAt,
      transaction_snapshot_conflict: "currency",
    });
  });

  it("refuses a direct change of the stored amount", async () => {
    const updated = await admin
      .from("checkout_sessions")
      .update({ transaction_amount: "1.00" })
      .eq("id", SESSION);
    expect(updated.error).toBeTruthy();
    expect(moneyText((await readSession(SESSION))?.transaction_amount)).toBe(PROVIDER_AMOUNT);
  });

  it("retries a failed provider read without creating a second snapshot", async () => {
    harness.payments.set(RETRY_PAYMENT, {
      throwOnce: true,
      payment: payment({ id: RETRY_PAYMENT, amount: PROVIDER_AMOUNT, externalReference: RETRY_MUTATION }),
    });
    await expect(applyMercadoPagoCheckoutProWebhookEvent(notification(RETRY_PAYMENT))).rejects.toThrow(
      "mercadopago_checkout_pro_get_payment_failed"
    );
    expect(await readSession(RETRY_SESSION)).toMatchObject({ mp_payment_id: null, transaction_amount: null });

    const stored = await applyMercadoPagoCheckoutProWebhookEvent(notification(RETRY_PAYMENT));
    expect(stored.replay).toBe(false);
    const retryStored = await readSession(RETRY_SESSION);
    expect(retryStored).toMatchObject({
      mp_payment_id: RETRY_PAYMENT,
      transaction_currency: "BRL",
    });
    expect(moneyText(retryStored?.transaction_amount)).toBe(PROVIDER_AMOUNT);
    await admin.from("checkout_sessions").update({ onboarding_status: "completed" }).eq("id", RETRY_SESSION);
    const again = await applyMercadoPagoCheckoutProWebhookEvent(notification(RETRY_PAYMENT));
    expect(again.replay).toBe(true);
    const { count, error } = await admin
      .from("checkout_sessions")
      .select("id", { count: "exact", head: true })
      .eq("mp_payment_id", RETRY_PAYMENT);
    if (error) throw error;
    expect(count).toBe(1);
  });

  it("lets two simultaneous webhooks create one snapshot", async () => {
    harness.payments.set(RACE_PAYMENT, {
      payment: payment({ id: RACE_PAYMENT, amount: PROVIDER_AMOUNT, externalReference: RACE_MUTATION }),
    });
    const results = await Promise.all([
      applyMercadoPagoCheckoutProWebhookEvent(notification(RACE_PAYMENT)),
      applyMercadoPagoCheckoutProWebhookEvent(notification(RACE_PAYMENT)),
    ]);
    expect(results.filter((result) => result.ignored)).toHaveLength(0);
    const stored = await readSession(RACE_SESSION);
    expect(stored).toMatchObject({
      mp_payment_id: RACE_PAYMENT,
      transaction_currency: "BRL",
      transaction_snapshot_conflict: null,
    });
    expect(moneyText(stored?.transaction_amount)).toBe(PROVIDER_AMOUNT);
    const { count, error } = await admin
      .from("checkout_sessions")
      .select("id", { count: "exact", head: true })
      .eq("mp_payment_id", RACE_PAYMENT);
    if (error) throw error;
    expect(count).toBe(1);
  });

  it("keeps the live refund dispatch disabled and the webhook free of plan prices", () => {
    expect(dispatchMercadoPagoRefund()).toEqual({ ok: false, error: "provider_refund_not_enabled" });
    const source = readFileSync(
      join(process.cwd(), "src/lib/server/mercadopago-checkout-pro-webhook.ts"),
      "utf8"
    );
    expect(source).not.toContain("plans.amount");
    expect(source).not.toContain("contracted_amount");
    expect(source).not.toContain("claim_refund_processing");
  });
});

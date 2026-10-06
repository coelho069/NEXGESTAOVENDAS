import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { refundIdempotencyKey } from "@/lib/domain/mercadopago-refund";
import { sandboxRefundId } from "@/lib/domain/mercadopago-refund-sandbox";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getPlatformAdminAccess: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));

vi.mock("@/lib/auth/admin", () => ({
  getPlatformAdminAccess: mocks.getPlatformAdminAccess,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { POST } from "@/app/api/admin/reembolsos/processar/route";
import type { SandboxScenario } from "@/lib/domain/mercadopago-refund-sandbox";
import { processAdminSandboxRefund } from "@/lib/server/admin-sandbox-refund-processing";

const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CUSTOMER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_SESSION_ID = "33333333-3333-4333-8333-333333333333";
const PAYMENT_ID = "910583210401";

const ALLOWED_RPC = new Set([
  "claim_refund_processing",
  "dispatch_sandbox_refund",
  "complete_sandbox_refund",
  "fail_sandbox_refund",
  "timeout_sandbox_refund",
  "retry_sandbox_refund",
  "fail_refund_processing",
]);

type RefundRow = {
  id: string;
  status: string;
  mp_payment_id: string;
  provider: "mercadopago";
  provider_refund_status: string;
  checkout_session_id: string | null;
  requester_user_id?: string | null;
  processing_state: string | null;
  processing_attempts: number;
  idempotency_key: string | null;
  provider_refund_id: string | null;
  processing_finished_at: string | null;
  processing_error_class: string | null;
  last_processing_error: string | null;
  financial_effect: boolean;
};

type SessionRow = {
  id: string;
  mp_payment_id: string;
  onboarding_user_id: string;
  transaction_amount: string | null;
  transaction_currency: string | null;
  transaction_paid_at: string | null;
  mp_payment_status: string;
  plan_amount?: string;
  contracted_amount?: string;
};

type RpcCall = { name: string; args: Record<string, unknown> };

function createDb(options?: { synchronizeRefundLoads?: boolean }) {
  const refunds = new Map<string, RefundRow>();
  const sessions = new Map<string, SessionRow>();
  const calls: RpcCall[] = [];
  const tables = { plans: 0 };
  let refundLoads = 0;
  let releaseRefundLoads: (() => void) | null = null;
  const refundLoadBarrier = options?.synchronizeRefundLoads
    ? new Promise<void>((resolve) => {
        releaseRefundLoads = resolve;
      })
    : null;

  function sessionByPayment(paymentId: string) {
    return [...sessions.values()].find((session) => session.mp_payment_id === paymentId) ?? null;
  }

  function fail(error: string, extra: Record<string, unknown> = {}) {
    return { data: { ok: false, error, financial_effect: false, ...extra }, error: null };
  }

  function apply(name: string, args: Record<string, unknown>) {
    const id = String(args.p_refund_request_id ?? "");
    const row = refunds.get(id);
    const actor = typeof args.p_actor_user_id === "string" ? args.p_actor_user_id : null;
    if (name === "claim_refund_processing") {
      if (!row) return { data: { acquired: false, reason: "not_found" }, error: null };
      if (row.status !== "approved" || row.provider_refund_status !== "not_sent") {
        return { data: { acquired: false, reason: "not_approved", provider_refund_status: row.provider_refund_status }, error: null };
      }
      if (row.processing_state === "processing") {
        return { data: { acquired: false, reason: "in_progress", idempotency_key: row.idempotency_key }, error: null };
      }
      row.idempotency_key = `mercadopago:refund:${row.id}`;
      row.processing_state = "processing";
      row.processing_attempts += 1;
      row.financial_effect = false;
      return {
        data: {
          acquired: true,
          reason: "claimed",
          idempotency_key: row.idempotency_key,
          processing_state: "processing",
          processing_attempts: row.processing_attempts,
          provider_refund_status: "not_sent",
        },
        error: null,
      };
    }
    if (!row) return fail("not_found");
    const session = sessionByPayment(row.mp_payment_id);
    if (name === "dispatch_sandbox_refund") {
      if (!session || session.onboarding_user_id !== actor) return fail("not_owner");
      if (session.transaction_amount == null || session.transaction_paid_at == null) return fail("paid_amount_unavailable");
      if (session.transaction_currency !== "BRL") return fail("invalid_currency");
      if (row.processing_state !== "processing" || row.status !== "approved" || row.provider_refund_status !== "not_sent") {
        return fail("not_approved");
      }
      row.status = "processing";
      row.provider_refund_status = "processing";
      row.financial_effect = false;
      return {
        data: {
          ok: true,
          financial_effect: false,
          status: row.status,
          provider_refund_status: row.provider_refund_status,
          idempotency_key: row.idempotency_key,
          processing_state: row.processing_state,
          processing_attempts: row.processing_attempts,
          processing_finished_at: null,
        },
        error: null,
      };
    }
    if (name === "complete_sandbox_refund") {
      if (!session || session.onboarding_user_id !== actor) return fail("not_owner");
      const providerId = String(args.p_provider_refund_id ?? "");
      if (row.status === "refunded" && row.provider_refund_id === providerId) {
        return {
          data: {
            ok: true,
            replay: true,
            financial_effect: false,
            status: "refunded",
            provider_refund_status: "completed",
            provider_refund_id: row.provider_refund_id,
            idempotency_key: row.idempotency_key,
            processing_attempts: row.processing_attempts,
            processing_finished_at: row.processing_finished_at,
          },
          error: null,
        };
      }
      if (args.p_amount !== session.transaction_amount || args.p_currency !== "BRL") return fail("snapshot_amount_mismatch");
      if (!/^sandbox_[a-f0-9]{32}$/.test(providerId)) return fail("untrusted_provider_refund_id");
      row.status = "refunded";
      row.provider_refund_status = "completed";
      row.provider_refund_id = providerId;
      row.processing_state = "completed";
      row.processing_finished_at = "2026-10-06T20:00:00.000Z";
      row.financial_effect = false;
      return {
        data: {
          ok: true,
          replay: false,
          financial_effect: false,
          status: "refunded",
          provider_refund_status: "completed",
          provider_refund_id: providerId,
          idempotency_key: row.idempotency_key,
          processing_state: "completed",
          processing_attempts: row.processing_attempts,
          processing_finished_at: row.processing_finished_at,
        },
        error: null,
      };
    }
    if (name === "fail_sandbox_refund") {
      if (!session || session.onboarding_user_id !== actor) return fail("not_owner");
      const errorClass = args.p_error_class === "permanent" ? "permanent" : "temporary";
      row.processing_state = "failed";
      row.provider_refund_status = "failed";
      row.processing_error_class = errorClass;
      row.last_processing_error = String(args.p_error ?? "provider_error");
      row.provider_refund_id = null;
      row.processing_finished_at = null;
      row.financial_effect = false;
      return {
        data: {
          ok: true,
          financial_effect: false,
          status: row.status,
          provider_refund_status: "failed",
          provider_refund_id: null,
          idempotency_key: row.idempotency_key,
          processing_state: "failed",
          processing_error_class: errorClass,
          processing_attempts: row.processing_attempts,
          retryable: errorClass === "temporary",
          processing_finished_at: null,
        },
        error: null,
      };
    }
    if (name === "timeout_sandbox_refund") {
      if (!session || session.onboarding_user_id !== actor) return fail("not_owner");
      row.processing_state = "unknown";
      row.processing_error_class = "timeout";
      row.last_processing_error = "provider_timeout";
      row.provider_refund_id = null;
      row.processing_finished_at = null;
      row.financial_effect = false;
      return {
        data: {
          ok: true,
          financial_effect: false,
          status: row.status,
          provider_refund_status: row.provider_refund_status,
          provider_refund_id: null,
          idempotency_key: row.idempotency_key,
          processing_state: "unknown",
          processing_error_class: "timeout",
          processing_attempts: row.processing_attempts,
          retryable: true,
          processing_finished_at: null,
        },
        error: null,
      };
    }
    if (name === "retry_sandbox_refund") {
      if (row.status === "refunded") return fail("already_refunded");
      if (row.processing_error_class === "permanent") {
        return fail("not_retryable", { processing_attempts: row.processing_attempts, status: row.status });
      }
      if (row.processing_attempts >= 5) return fail("retry_exhausted", { processing_attempts: row.processing_attempts });
      const retryable =
        (row.processing_state === "failed" && row.processing_error_class === "temporary") ||
        (row.processing_state === "unknown" && row.processing_error_class === "timeout");
      if (!retryable) return fail("processing_in_progress");
      if (!session || session.onboarding_user_id !== actor) return fail("not_owner");
      row.processing_attempts += 1;
      row.processing_state = "processing";
      row.provider_refund_status = "processing";
      row.status = "processing";
      row.processing_error_class = null;
      row.last_processing_error = null;
      row.processing_finished_at = null;
      row.financial_effect = false;
      return {
        data: {
          ok: true,
          financial_effect: false,
          status: "processing",
          provider_refund_status: "processing",
          idempotency_key: row.idempotency_key,
          processing_state: "processing",
          processing_attempts: row.processing_attempts,
          provider_refund_id: null,
        },
        error: null,
      };
    }
    if (name === "fail_refund_processing") {
      row.processing_state = "failed";
      row.financial_effect = false;
      return { data: { ok: true, financial_effect: false }, error: null };
    }
    throw new Error(`unexpected_rpc:${name}`);
  }

  const admin = {
    from(table: string) {
      if (table === "plans") tables.plans += 1;
      return {
        select() {
          return {
            eq(column: string, value: string) {
              return {
                async maybeSingle() {
                  if (table === "refund_requests" && column === "id") {
                    if (refundLoadBarrier) {
                      refundLoads += 1;
                      if (refundLoads >= 2) releaseRefundLoads?.();
                      else await refundLoadBarrier;
                    }
                    return { data: refunds.get(value) ?? null, error: null };
                  }
                  if (table === "checkout_sessions" && column === "mp_payment_id") {
                    return { data: sessionByPayment(value), error: null };
                  }
                  if (table === "checkout_sessions" && column === "id") {
                    return { data: sessions.get(value) ?? null, error: null };
                  }
                  return { data: null, error: null };
                },
              };
            },
          };
        },
      };
    },
    rpc(name: string, args: Record<string, unknown>) {
      if (/stripe|mercadopago\.com|api\.stripe/i.test(name)) {
        throw new Error("external_provider_rpc");
      }
      const result = apply(name, args);
      calls.push({ name, args });
      return Promise.resolve(result);
    },
  };

  return { admin: admin as unknown as SupabaseClient<Database>, refunds, sessions, calls, tables };
}

function seed(db: ReturnType<typeof createDb>, status = "approved", amount: string | null = "100.00") {
  db.refunds.set(REQUEST_ID, {
    id: REQUEST_ID,
    status,
    mp_payment_id: PAYMENT_ID,
    provider: "mercadopago",
    provider_refund_status: "not_sent",
    checkout_session_id: SESSION_ID,
    processing_state: null,
    processing_attempts: 0,
    idempotency_key: null,
    provider_refund_id: null,
    processing_finished_at: null,
    processing_error_class: null,
    last_processing_error: null,
    financial_effect: false,
  });
  db.sessions.set(SESSION_ID, {
    id: SESSION_ID,
    mp_payment_id: PAYMENT_ID,
    onboarding_user_id: CUSTOMER_ID,
    transaction_amount: amount,
    transaction_currency: amount ? "BRL" : null,
    transaction_paid_at: amount ? "2026-10-01T15:00:00.000Z" : null,
    mp_payment_status: "approved",
    plan_amount: "999.00",
    contracted_amount: "50.00",
  });
}

function post(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return POST(
    new Request("https://nexgestaovendas.com.br/api/admin/reembolsos/processar", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "https://nexgestaovendas.com.br",
        "sec-fetch-site": "same-origin",
        ...headers,
      },
      body: JSON.stringify(body),
    })
  );
}

const LOCAL_SUPABASE = "http://127.0.0.1:54321";
const LOCAL_POSTGRES = "postgresql://postgres@127.0.0.1:54322/postgres";
const LOCAL_ENV = {
  NODE_ENV: "test",
  REFUND_SANDBOX_PROCESSING: "local",
  NEXT_PUBLIC_SUPABASE_URL: LOCAL_SUPABASE,
  SUPABASE_URL: LOCAL_SUPABASE,
  DATABASE_URL: LOCAL_POSTGRES,
  POSTGRES_URL: LOCAL_POSTGRES,
  SUPABASE_DB_URL: LOCAL_POSTGRES,
};

const previousEnv = {
  APP_ORIGIN: process.env.APP_ORIGIN,
  REFUND_SANDBOX_PROCESSING: process.env.REFUND_SANDBOX_PROCESSING,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  DATABASE_URL: process.env.DATABASE_URL,
  POSTGRES_URL: process.env.POSTGRES_URL,
  SUPABASE_DB_URL: process.env.SUPABASE_DB_URL,
};

function applyLocalDatabaseEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = LOCAL_SUPABASE;
  process.env.SUPABASE_URL = LOCAL_SUPABASE;
  process.env.DATABASE_URL = LOCAL_POSTGRES;
  process.env.POSTGRES_URL = LOCAL_POSTGRES;
  process.env.SUPABASE_DB_URL = LOCAL_POSTGRES;
}

describe("POST /api/admin/reembolsos/processar", () => {
  const fetchSpy = vi.fn(() => {
    throw new Error("external_http");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_ORIGIN = "https://nexgestaovendas.com.br";
    process.env.REFUND_SANDBOX_PROCESSING = "local";
    applyLocalDatabaseEnv();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubGlobal("fetch", fetchSpy);
    mocks.getUser.mockResolvedValue({ data: { user: { id: ADMIN_ID } } });
    mocks.getPlatformAdminAccess.mockResolvedValue({ userId: ADMIN_ID, role: "platform_admin" });
  });

  afterEach(() => {
    process.env.APP_ORIGIN = previousEnv.APP_ORIGIN;
    process.env.REFUND_SANDBOX_PROCESSING = previousEnv.REFUND_SANDBOX_PROCESSING;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousEnv.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_URL = previousEnv.SUPABASE_URL;
    process.env.DATABASE_URL = previousEnv.DATABASE_URL;
    process.env.POSTGRES_URL = previousEnv.POSTGRES_URL;
    process.env.SUPABASE_DB_URL = previousEnv.SUPABASE_DB_URL;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function useDb(status = "approved", amount: string | null = "100.00", options?: { synchronizeRefundLoads?: boolean }) {
    const db = createDb(options);
    seed(db, status, amount);
    mocks.createAdminClient.mockReturnValue(db.admin);
    return db;
  }

  function harness(db: ReturnType<typeof createDb>, scenario: SandboxScenario, retry = false) {
    return processAdminSandboxRefund({
      admin: db.admin,
      refundRequestId: REQUEST_ID,
      scenario,
      retry,
      env: LOCAL_ENV,
    });
  }

  it("rejects an invalid CSRF origin before the database", async () => {
    const response = await post({ id: REQUEST_ID, confirm: true }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "csrf_failed" });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a missing session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const response = await post({ id: REQUEST_ID, confirm: true });
    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a signed-in user who is not a platform admin", async () => {
    mocks.getPlatformAdminAccess.mockResolvedValue(null);
    const response = await post({ id: REQUEST_ID, confirm: true });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "forbidden" });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed when the sandbox flag is absent or production is set", async () => {
    delete process.env.REFUND_SANDBOX_PROCESSING;
    const missing = await post({ id: REQUEST_ID, confirm: true });
    expect(missing.status).toBe(403);
    expect(await missing.json()).toMatchObject({ error: "sandbox_disabled" });

    process.env.REFUND_SANDBOX_PROCESSING = "local";
    vi.stubEnv("NODE_ENV", "production");
    const production = await post({ id: REQUEST_ID, confirm: true });
    expect(production.status).toBe(403);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(["submitted", "requested", "in_review", "rejected", "withdrawn"])(
    "does not process status %s",
    async (status) => {
      const db = useDb(status);
      const response = await post({ id: REQUEST_ID, confirm: true });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: "not_approved", financial_effect: false });
      expect(db.calls).toEqual([]);
      expect(db.refunds.get(REQUEST_ID)?.status).toBe(status);
    }
  );

  it("returns paid_amount_unavailable when the snapshot amount is missing", async () => {
    const db = useDb("approved", null);
    const response = await post({ id: REQUEST_ID, confirm: true });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "paid_amount_unavailable", financial_effect: false });
    expect(db.calls).toEqual([]);
    expect(db.tables.plans).toBe(0);
  });

  it("rejects browser fields before opening the database", async () => {
    const db = useDb();
    const response = await post({
      id: REQUEST_ID,
      confirm: true,
      amount: "1.00",
      provider: "stripe",
      provider_refund_id: "mp-real-should-be-ignored",
      provider_refund_status: "completed",
      requester_user_id: OTHER_ID,
      onboarding_user_id: OTHER_ID,
      checkout_session_id: OTHER_SESSION_ID,
      scenario: "timeout",
      financial_effect: true,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "validation_failed", financial_effect: false });
    expect(db.calls).toEqual([]);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(db.refunds.get(REQUEST_ID)?.status).toBe("approved");
  });

  it("rejects a payment that belongs to another client", async () => {
    const db = useDb();
    db.sessions.set(OTHER_SESSION_ID, {
      id: OTHER_SESSION_ID,
      mp_payment_id: "910583210499",
      onboarding_user_id: OTHER_ID,
      transaction_amount: "100.00",
      transaction_currency: "BRL",
      transaction_paid_at: "2026-10-01T15:00:00.000Z",
      mp_payment_status: "approved",
    });
    db.refunds.get(REQUEST_ID)!.checkout_session_id = OTHER_SESSION_ID;
    const response = await post({ id: REQUEST_ID, confirm: true });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "not_owner" });
    expect(db.calls).toEqual([]);
  });

  it("rejects a request that has no checkout session", async () => {
    const db = useDb();
    db.refunds.get(REQUEST_ID)!.checkout_session_id = null;
    const response = await post({ id: REQUEST_ID, confirm: true });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "not_owner", financial_effect: false });
    expect(db.calls).toEqual([]);
  });

  it("rejects a stored requester that is not the payment owner", async () => {
    const db = useDb();
    db.refunds.get(REQUEST_ID)!.requester_user_id = OTHER_ID;
    const response = await post({ id: REQUEST_ID, confirm: true });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "not_owner" });
    expect(db.calls).toEqual([]);
    expect(db.calls.some((call) => call.name === "complete_sandbox_refund")).toBe(false);
  });

  it("accepts a stored requester that matches the checkout owner", async () => {
    const db = useDb();
    db.refunds.get(REQUEST_ID)!.requester_user_id = CUSTOMER_ID;
    const response = await post({ id: REQUEST_ID, confirm: true });
    expect(response.status).toBe(200);
    expect(db.calls.find((call) => call.name === "complete_sandbox_refund")?.args).toMatchObject({
      p_actor_user_id: CUSTOMER_ID,
    });
  });

  it("processes an approved request with the snapshot amount and ignores client fields", async () => {
    const db = useDb();
    const response = await post({
      id: REQUEST_ID,
      confirm: true,
    });
    const body = await response.json();
    const row = db.refunds.get(REQUEST_ID)!;
    const expectedId = sandboxRefundId(refundIdempotencyKey(REQUEST_ID));
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      status: "refunded",
      provider_refund_status: "completed",
      provider_refund_id: expectedId,
      financial_effect: false,
      retryable: false,
      amount: "100.00",
    });
    expect(row).toMatchObject({
      status: "refunded",
      provider_refund_status: "completed",
      provider_refund_id: expectedId,
      processing_finished_at: "2026-10-06T20:00:00.000Z",
      financial_effect: false,
    });
    expect(db.calls.find((call) => call.name === "complete_sandbox_refund")?.args).toMatchObject({
      p_actor_user_id: CUSTOMER_ID,
      p_amount: "100.00",
      p_currency: "BRL",
      p_provider_refund_id: expectedId,
    });
    expect(db.calls.some((call) => call.args.p_actor_user_id === ADMIN_ID)).toBe(false);
    expect(JSON.stringify(db.calls)).not.toContain("mp-real-should-be-ignored");
    expect(JSON.stringify(db.calls)).not.toContain("stripe");
    expect(db.calls.every((call) => ALLOWED_RPC.has(call.name))).toBe(true);
    expect(db.tables.plans).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps a temporary error retryable and then settles once", async () => {
    const db = useDb();
    const failed = await harness(db, "temporary_error");
    expect(failed.httpStatus).toBe(200);
    expect(failed.body).toMatchObject({
      ok: false,
      error: "provider_unavailable",
      status: "processing",
      retryable: true,
      financial_effect: false,
      provider_refund_id: null,
    });
    expect(db.refunds.get(REQUEST_ID)?.status).not.toBe("refunded");

    const retried = await harness(db, "success", true);
    expect(retried.httpStatus).toBe(200);
    expect(retried.body).toMatchObject({ ok: true, status: "refunded", financial_effect: false });
    expect(db.refunds.get(REQUEST_ID)?.processing_attempts).toBe(2);
    expect(db.refunds.get(REQUEST_ID)?.idempotency_key).toBe(`mercadopago:refund:${REQUEST_ID}`);
    expect(db.calls.filter((call) => call.name === "complete_sandbox_refund")).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks a permanent error from an unlimited retry", async () => {
    const db = useDb();
    const failed = await harness(db, "permanent_error");
    expect(failed.body).toMatchObject({
      ok: false,
      error: "refund_not_allowed",
      retryable: false,
      financial_effect: false,
    });
    const again = await harness(db, "success", true);
    expect(again.httpStatus).toBe(409);
    expect(again.body).toMatchObject({ error: "not_retryable", financial_effect: false });
    expect(db.refunds.get(REQUEST_ID)?.status).not.toBe("refunded");
    expect(db.calls.filter((call) => call.name === "complete_sandbox_refund")).toHaveLength(0);

    db.refunds.get(REQUEST_ID)!.processing_error_class = "temporary";
    db.refunds.get(REQUEST_ID)!.processing_attempts = 5;
    const exhausted = await harness(db, "success", true);
    expect(exhausted.httpStatus).toBe(409);
    expect(exhausted.body).toMatchObject({ error: "retry_exhausted" });
    expect(db.refunds.get(REQUEST_ID)?.status).not.toBe("refunded");
  });

  it("does not mark a timeout as refunded", async () => {
    const db = useDb();
    const response = await harness(db, "timeout");
    const row = db.refunds.get(REQUEST_ID)!;
    expect(response.body).toMatchObject({
      ok: false,
      error: "provider_timeout",
      status: "processing",
      provider_refund_status: "processing",
      provider_refund_id: null,
      processing_state: "unknown",
      processing_finished_at: null,
      retryable: true,
      financial_effect: false,
    });
    expect(row.status).not.toBe("refunded");
    expect(row.provider_refund_id).toBeNull();
    expect(row.processing_finished_at).toBeNull();
    expect(row.financial_effect).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps a duplicate provider response as one refund", async () => {
    const db = useDb();
    const first = await harness(db, "duplicate_response");
    expect(first.body).toMatchObject({ ok: true, status: "refunded", financial_effect: false });
    const second = await harness(db, "duplicate_response");
    expect(second.body).toMatchObject({ ok: true, status: "refunded", replayed: true, financial_effect: false });
    expect(db.calls.filter((call) => call.name === "complete_sandbox_refund")).toHaveLength(1);
    expect(db.calls.filter((call) => call.name === "claim_refund_processing")).toHaveLength(1);
    expect(db.refunds.get(REQUEST_ID)?.provider_refund_id).toBe(sandboxRefundId(refundIdempotencyKey(REQUEST_ID)));
  });

  it("lets only one concurrent execution acquire the claim", async () => {
    const db = useDb("approved", "100.00", { synchronizeRefundLoads: true });
    const [first, second] = await Promise.all([
      post({ id: REQUEST_ID, confirm: true }),
      post({ id: REQUEST_ID, confirm: true }),
    ]);
    const statuses = [first.status, second.status].sort((left, right) => left - right);
    expect(statuses).toEqual([200, 409]);
    const bodies = (await Promise.all([first.json(), second.json()])) as Array<{
      ok?: boolean;
      status?: string;
      error?: string;
    }>;
    expect(bodies.filter((body) => body.status === "refunded" && body.ok === true)).toHaveLength(1);
    expect(bodies.some((body) => body.error === "processing_in_progress" || body.error === "not_approved")).toBe(true);
    expect(db.calls.filter((call) => call.name === "complete_sandbox_refund")).toHaveLength(1);
    expect(db.calls.filter((call) => call.name === "claim_refund_processing" && call.args)).toBeTruthy();
    expect(db.refunds.get(REQUEST_ID)?.financial_effect).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

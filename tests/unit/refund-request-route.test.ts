import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getAuthedContext: vi.fn(),
  createAdminClient: vi.fn(),
  findCheckoutByPaymentId: vi.fn(),
  hasOpenRequest: vi.fn(),
  createOwnedRefundRequest: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthedContext: mocks.getAuthedContext,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/server/client-refund-requests", () => ({
  createClientRefundReader: () => ({
    findCheckoutByPaymentId: mocks.findCheckoutByPaymentId,
    hasOpenRequest: mocks.hasOpenRequest,
  }),
  createOwnedRefundRequest: mocks.createOwnedRefundRequest,
  ownedRefundStore: () => ({}),
}));

import { POST } from "@/app/api/refund-requests/route";
import { resetRateLimitStateForTests } from "@/lib/security/rate-limit";

const sessionUser = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "client-a@gmail.com",
  email_confirmed_at: "2026-10-01T12:00:00.000Z",
};

function post(headers: Record<string, string>, body: unknown) {
  return POST(
    new Request("https://nexgestaovendas.com.br/api/refund-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    })
  );
}

const validBody = {
  client_mutation_id: "44444444-4444-4444-8444-444444444444",
  mp_payment_id: "123456789",
  reason: "arrependimento",
  notes: "",
  confirmed: true,
  payer_email: "intruder@example.com",
  amount: "1.00",
  provider: "stripe",
};

describe("POST /api/refund-requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStateForTests();
    mocks.getUser.mockResolvedValue({ data: { user: sessionUser } });
    mocks.getAuthedContext.mockResolvedValue({ orgId: "33333333-3333-4333-8333-333333333333" });
    mocks.createAdminClient.mockReturnValue({});
    mocks.findCheckoutByPaymentId.mockResolvedValue(null);
    mocks.hasOpenRequest.mockResolvedValue(false);
    mocks.createOwnedRefundRequest.mockResolvedValue({
      ok: false,
      error: "payment_not_owned",
      status: 403,
    });
  });

  it("rejects a cross-site origin and a missing origin before touching the database", async () => {
    const crossSite = await post(
      { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      validBody
    );
    expect(crossSite.status).toBe(403);
    const missingOrigin = await post({ "sec-fetch-site": "same-origin" }, validBody);
    expect(missingOrigin.status).toBe(403);
    const missingFetchSite = await post({}, validBody);
    expect(missingFetchSite.status).toBe(403);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects an anonymous caller", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const response = await post(
      { origin: "https://nexgestaovendas.com.br", "sec-fetch-site": "same-origin" },
      validBody
    );
    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.createOwnedRefundRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["unverified Gmail", "person@gmail.com", null],
    ["Outlook", "person@outlook.com", "2026-10-01T12:00:00.000Z"],
    ["Hotmail", "person@hotmail.com", "2026-10-01T12:00:00.000Z"],
    ["Yahoo", "person@yahoo.com", "2026-10-01T12:00:00.000Z"],
    ["empty email", "", "2026-10-01T12:00:00.000Z"],
    ["internal space", "person @gmail.com", "2026-10-01T12:00:00.000Z"],
    ["lookalike domain", "person@gmail.com.evil", "2026-10-01T12:00:00.000Z"],
  ])("blocks %s before creating a refund request", async (_label, email, confirmedAt) => {
    mocks.getUser.mockResolvedValue({
      data: { user: { ...sessionUser, email, email_confirmed_at: confirmedAt } },
    });
    const response = await post(
      { origin: "https://nexgestaovendas.com.br", "sec-fetch-site": "same-origin" },
      { ...validBody, payer_email: "person@gmail.com" }
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "gmail_verified_required" });
    expect(mocks.createOwnedRefundRequest).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("normalizes a verified Gmail address and ignores the client email", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          ...sessionUser,
          email: "  CLIENT-A@GMAIL.COM  ",
          email_confirmed_at: "2026-10-01T12:00:00.000Z",
        },
      },
    });
    const response = await post(
      { origin: "https://nexgestaovendas.com.br", "sec-fetch-site": "same-origin" },
      { ...validBody, payer_email: "person@outlook.com" }
    );
    expect(response.status).toBe(403);
    expect(mocks.createOwnedRefundRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actor: expect.objectContaining({ email: "client-a@gmail.com" }),
      })
    );
    const passed = mocks.createOwnedRefundRequest.mock.calls[0]?.[1] as { actor: { email: string } };
    expect(passed.actor.email).not.toBe("person@outlook.com");
  });

  it("keeps the rate limit ahead of the Gmail gate", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "55555555-5555-4555-8555-555555555555",
          email: "person@outlook.com",
          email_confirmed_at: "2026-10-01T12:00:00.000Z",
        },
      },
    });
    const headers = { origin: "https://nexgestaovendas.com.br", "sec-fetch-site": "same-origin" };
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const blocked = await post(headers, validBody);
      expect(blocked.status).toBe(403);
    }
    const limited = await post(headers, validBody);
    expect(limited.status).toBe(429);
    expect(mocks.createOwnedRefundRequest).not.toHaveBeenCalled();
  });

  it("uses the signed-in client and rejects another payment id", async () => {
    const response = await post(
      { origin: "https://nexgestaovendas.com.br", "sec-fetch-site": "same-origin" },
      { ...validBody, mp_payment_id: "999999999" }
    );
    expect(response.status).toBe(403);
    expect(mocks.createOwnedRefundRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actor: expect.objectContaining({ email: "client-a@gmail.com", userId: sessionUser.id }),
        mpPaymentId: "999999999",
      })
    );
    const passed = mocks.createOwnedRefundRequest.mock.calls[0]?.[1] as { actor: { email: string } };
    expect(passed.actor.email).not.toBe("intruder@example.com");
  });

  it("blocks a second open request for the same payment", async () => {
    mocks.createOwnedRefundRequest.mockResolvedValue({
      ok: false,
      error: "open_refund_request_exists",
      status: 409,
    });
    const response = await post(
      { origin: "https://nexgestaovendas.com.br", "sec-fetch-site": "same-origin" },
      validBody
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "open_refund_request_exists" });
  });

  it("accepts the same-origin request without calling a provider refund", async () => {
    mocks.createOwnedRefundRequest.mockResolvedValue({
      ok: true,
      id: "88888888-8888-4888-8888-888888888888",
      status: "submitted",
      replayed: false,
    });
    const response = await post(
      { origin: "https://nexgestaovendas.com.br", "sec-fetch-site": "same-origin" },
      validBody
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ ok: true, status: "submitted" });
  });
});

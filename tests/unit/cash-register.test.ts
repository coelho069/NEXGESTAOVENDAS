import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculateCashDifference,
  calculateExpectedCash,
  canTransitionCashSession,
} from "@/lib/domain/cash";
import type { AuthedContext } from "@/lib/auth/session";

const { getAuthedContext, createClient } = vi.hoisted(() => ({
  getAuthedContext: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getAuthedContext }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

import { GET, POST } from "@/app/api/cash/session/route";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const STORE_ID = "22222222-2222-4222-8222-222222222201";
const TERMINAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_ID = "66666666-6666-4666-8666-666666666666";
const MUTATION_ID = "99999999-9999-4999-8999-999999999901";

function managerContext(): AuthedContext {
  return {
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    role: "manager",
    orgId: ORG_ID,
    storeId: STORE_ID,
    storeName: "Loja Centro",
    stores: [{ id: STORE_ID, name: "Loja Centro", orgId: ORG_ID, role: "manager" }],
  };
}

function request(url: string, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("cash ledger domain", () => {
  it("calculates expected balance with decimal strings", () => {
    expect(
      calculateExpectedCash("100.00", [{ amount: "0.10" }, { amount: "19.90" }, { amount: "-5.00" }])
    ).toBe("115.00");
    expect(calculateCashDifference("114.99", "115.00")).toBe("-0.01");
  });

  it("allows only the explicit open-to-closed transition", () => {
    expect(canTransitionCashSession("open", "closed")).toBe(true);
    expect(canTransitionCashSession("open", "open")).toBe(false);
    expect(canTransitionCashSession("closed", "open")).toBe(false);
    expect(canTransitionCashSession("closed", "closed")).toBe(false);
  });
});

describe("cash API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthedContext.mockResolvedValue(managerContext());
    createClient.mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({
        data: {
          session: null,
          movements: [],
          expected_amount: "0.00",
        },
        error: null,
      }),
    });
  });

  it("derives access from the authenticated store context and strips the UI action", async () => {
    const response = await POST(
      request("/api/cash/session", {
        action: "open",
        store_id: STORE_ID,
        terminal_id: TERMINAL_ID,
        client_mutation_id: MUTATION_ID,
        opening_amount: "100.00",
      })
    );

    expect(response.status).toBe(200);
    expect(getAuthedContext).toHaveBeenCalledWith(STORE_ID);
    const client = await createClient.mock.results[0]?.value;
    expect(client.rpc).toHaveBeenCalledWith("open_cash_session", {
      p_payload: {
        store_id: STORE_ID,
        terminal_id: TERMINAL_ID,
        client_mutation_id: MUTATION_ID,
        opening_amount: "100.00",
      },
    });
  });

  it("rejects an unauthorised store before calling the RPC", async () => {
    getAuthedContext.mockResolvedValue(null);
    const response = await GET(
      request(`/api/cash/session?store_id=${STORE_ID}&terminal_id=${TERMINAL_ID}`)
    );

    expect(response.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects negative supply/withdrawal amounts at the API boundary", async () => {
    const response = await POST(
      request("/api/cash/session", {
        action: "movement",
        cash_session_id: SESSION_ID,
        store_id: STORE_ID,
        terminal_id: TERMINAL_ID,
        client_mutation_id: MUTATION_ID,
        movement_type: "supply",
        amount: "-1.00",
        reason: "não permitido",
      })
    );

    expect(response.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("maps a server-side closed-session race to a controlled conflict", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "cash_session_closed", code: "40901" },
    });
    createClient.mockResolvedValue({ rpc });

    const response = await POST(
      request("/api/cash/session", {
        action: "close",
        cash_session_id: SESSION_ID,
        store_id: STORE_ID,
        terminal_id: TERMINAL_ID,
        client_mutation_id: MUTATION_ID,
        counted_amount: "100.00",
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "cash_session_closed" });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import {
  markClientAccountAccessEmailFailed,
  markClientAccountAccessEmailSent,
  syncClientAccountAfterPurchase,
} from "@/lib/server/client-account-sync";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUB_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ACCOUNT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeAdmin() {
  const accounts: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];

  const table = (name: "client_accounts" | "client_account_events") => {
    const rows = name === "client_accounts" ? accounts : events;
    const api: Record<string, unknown> = {};
    let criteria: Record<string, unknown> = {};

    api.select = () => api;
    api.eq = (col: string, val: unknown) => {
      criteria = { ...criteria, [col]: val };
      return api;
    };
    api.ilike = (col: string, val: unknown) => {
      criteria = { ...criteria, [col]: val };
      return api;
    };
    api.maybeSingle = async () => ({
      data:
        rows.find((row) =>
          Object.entries(criteria).every(
            ([key, value]) =>
              String(row[key] ?? "").toLowerCase() === String(value).toLowerCase()
          )
        ) ?? null,
      error: null,
    });
    api.insert = (value: Record<string, unknown>) => {
      const row = { id: ACCOUNT_ID, status: "created", ...value };
      rows.push(row);
      const chain = {
        select: () => chain,
        single: async () => ({ data: row, error: null }),
      };
      return chain;
    };
    api.update = (value: Record<string, unknown>) => {
      rows
        .filter((row) =>
          Object.entries(criteria).every(([key, val]) => row[key] === val)
        )
        .forEach((row) => Object.assign(row, value));
      const chain = {
        eq: (col: string, val: unknown) => {
          criteria = { ...criteria, [col]: val };
          return chain;
        },
      };
      return chain;
    };
    return api;
  };

  return {
    from: (name: string) => table(name as "client_accounts" | "client_account_events"),
    state: { accounts, events },
  } as unknown as SupabaseClient<Database> & { state: { accounts: Record<string, unknown>[]; events: Record<string, unknown>[] } };
}

describe("syncClientAccountAfterPurchase", () => {
  it("creates a client_accounts row after payment provisioning", async () => {
    const admin = makeAdmin();
    const result = await syncClientAccountAfterPurchase(admin, {
      userId: USER_ID,
      email: "cliente@exemplo.com",
      fullName: "Cliente Exemplo",
      companyName: "Loja Exemplo",
      orgId: ORG_ID,
      subscriptionId: SUB_ID,
      checkoutClientMutationId: "22222222-2222-4222-8222-222222222222",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);
    expect(admin.state.accounts[0]).toMatchObject({
      email: "cliente@exemplo.com",
      org_id: ORG_ID,
      subscription_id: SUB_ID,
      user_id: USER_ID,
      created_by: null,
    });
    expect(admin.state.events[0].event_type).toBe("account_created");
  });

  it("is idempotent for the same e-mail", async () => {
    const admin = makeAdmin();
    const input = {
      userId: USER_ID,
      email: "cliente@exemplo.com",
      fullName: "Cliente Exemplo",
      orgId: ORG_ID,
      subscriptionId: SUB_ID,
    };
    const first = await syncClientAccountAfterPurchase(admin, input);
    const second = await syncClientAccountAfterPurchase(admin, input);
    expect(first.ok && second.ok).toBe(true);
    expect(admin.state.accounts).toHaveLength(1);
  });
});

describe("access email state markers", () => {
  it("records sent and failed states without duplicating accounts", async () => {
    const admin = makeAdmin();
    admin.state.accounts.push({
      id: ACCOUNT_ID,
      status: "created",
      email: "cliente@exemplo.com",
    });

    await markClientAccountAccessEmailSent(admin, {
      clientAccountId: ACCOUNT_ID,
      now: Date.parse("2026-10-05T12:00:00.000Z"),
    });
    expect(admin.state.accounts[0].status).toBe("invite_sent");
    expect(admin.state.events.some((e) => e.event_type === "invite_sent")).toBe(true);

    await markClientAccountAccessEmailFailed(admin, {
      clientAccountId: ACCOUNT_ID,
      errorCode: "access_email_send_failed_status_500",
    });
    expect(admin.state.accounts[0].status).toBe("invite_failed");
  });
});

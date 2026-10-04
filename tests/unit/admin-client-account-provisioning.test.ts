import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

const { getPlatformAdminAccess, createAdminClient, createServerClient } = vi.hoisted(() => ({
  getPlatformAdminAccess: vi.fn(),
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
}));

vi.mock("@/lib/auth/admin", () => ({ getPlatformAdminAccess }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createServerClient }));

/** Recovery session double: only auth.getUser() is exercised. */
function withSessionUser(user: { id: string; email: string } | null) {
  createServerClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user } }) },
  });
}

import {
  createAdminClientAccountAction,
  resendAdminClientAccountInviteAction,
  setAdminClientAccountSuspendedAction,
  markClientAccountActivatedAction,
  CLIENT_ACCOUNT_INVITE_TTL_MS,
} from "@/lib/server/admin-client-account-provisioning";

const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
const ORG_ID = "11111111-1111-4111-8111-111111111111";
const SUB_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACCOUNT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = Date.parse("2026-10-05T12:00:00.000Z");

const VALID_INPUT = {
  full_name: "Maria Souza",
  email: "maria@empresa.com.br",
  company_name: "Souza Varejo",
  org_id: ORG_ID,
  subscription_id: SUB_ID,
  send_invite: true,
};

const GMAIL_ENV = {
  GMAIL_INVITE_ENABLED: "true",
  GMAIL_SENDER_ADDRESS: "contato@nexgestaovendas.com.br",
  GMAIL_OAUTH_CLIENT_ID: "id",
  GMAIL_OAUTH_CLIENT_SECRET: "secret",
  GMAIL_OAUTH_REFRESH_TOKEN: "refresh",
};

const ACTIVATION_LINK =
  "https://app.nexgestaovendas.com.br/auth/v1/verify?token=secret-token&type=invite&redirect_to=x";

/** Minimal Supabase admin double covering only the surface this module uses. */
function makeAdmin() {
  const state = {
    authUsers: [] as { id: string; email: string }[],
    accounts: [] as Record<string, unknown>[],
    events: [] as Record<string, unknown>[],
    profiles: [] as Record<string, unknown>[],
    stores: [] as Record<string, unknown>[],
    storeMembers: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
    bans: [] as { userId: string; banDuration: string }[],
  };

  const matchesRow = (row: Record<string, unknown>, criteria: Record<string, unknown>) =>
    Object.entries(criteria).every(
      ([key, value]) =>
        value === undefined ||
        String(row[key] ?? "").toLowerCase() === String(value).toLowerCase()
    );

  const seeded = {
    organizations: [{ id: ORG_ID, name: "Souza Varejo" }],
    subscriptions: [{ id: SUB_ID, org_id: ORG_ID, plan_id: "plan-pro" }],
    plans: [{ id: "plan-pro", name: "Plano Pro" }],
  };

  const table = (
    name:
      | "client_accounts"
      | "client_account_events"
      | "profiles"
      | "stores"
      | "store_members"
      | "subscriptions"
      | "organizations"
      | "plans"
  ) => {
    const rows =
      name === "client_accounts"
        ? state.accounts
        : name === "client_account_events"
          ? state.events
          : name === "profiles"
            ? state.profiles
            : name === "stores"
              ? state.stores
              : name === "store_members"
                ? state.storeMembers
                : (seeded[name] as Record<string, unknown>[]);
    const api: Record<string, unknown> = {};
    let criteria: Record<string, unknown> = {};

    api.select = () => api;
    api.eq = (col: string, value: unknown) => {
      criteria = { ...criteria, [col]: value };
      return api;
    };
    api.ilike = (col: string, value: unknown) => {
      criteria = { ...criteria, [col]: value };
      return api;
    };
    api.maybeSingle = async () => ({ data: rows.find((r) => matchesRow(r, criteria)) ?? null, error: null });
    // `insert(...).select(...).single()` arrives with empty criteria; the
    // affected row is the one just appended.
    api.single = async () => ({
      data:
        rows.find((r) => matchesRow(r, criteria)) ??
        (Object.keys(criteria).length === 0 ? rows[rows.length - 1] : null),
      error: null,
    });
    // Chainable and awaitable: `.insert(v)` alone and `.insert(v).select().single()`
    // both resolve, because Supabase builders are both.
    api.insert = (value: Record<string, unknown>) => {
      // Real uuids: the action boundary validates ids with z.string().uuid().
      const row = {
        id: rows.length === 0 ? ACCOUNT_ID : `dddddddd-dddd-4ddd-8ddd-00000000000${rows.length}`,
        ...value,
      };
      rows.push(row);
      return Object.assign(Promise.resolve({ data: row, error: null }), api);
    };
    // Chainable and awaitable, so both `.update(v).eq(c)` and `.update(v)`
    // resolve once the matching rows have been patched.
    api.update = (value: Record<string, unknown>) => {
      state.updates.push({ table: name, ...value });
      const run = () => {
        rows.filter((r) => matchesRow(r, criteria)).forEach((r) => Object.assign(r, value));
        return { data: null, error: null };
      };
      const chain = { eq: (col: string, val: unknown) => {
        criteria = { ...criteria, [col]: val };
        return chain;
      } };
      return Object.assign(Promise.resolve(run()), chain);
    };
    return api;
  };

  const admin = {
    from: (name: string) => table(name as never),
    auth: {
      admin: {
        listUsers: vi.fn(async () => ({ data: { users: state.authUsers }, error: null })),
        // Mirrors Supabase: an invite link creates the unconfirmed auth user.
        generateLink: vi.fn(async (args: { email: string }) => {
          state.authUsers.push({ id: USER_ID, email: args.email });
          return { data: { properties: { action_link: ACTIVATION_LINK } }, error: null };
        }),
        updateUserById: vi.fn(async (userId: string, payload: { ban_duration?: string }) => {
          state.bans.push({ userId, banDuration: payload.ban_duration ?? "" });
          return { data: {}, error: null };
        }),
      },
    },
    state,
  };
  // The double is a structural subset of the real client; widening it here
  // keeps every call site free of casts while the tests still observe `state`.
  return admin as unknown as SupabaseClient<Database> & typeof admin;
}

type AdminDouble = ReturnType<typeof makeAdmin>;

function authorizeAdmin() {
  getPlatformAdminAccess.mockResolvedValue({ userId: ADMIN_ID, role: "platform_admin" });
}

type InvitePayload = { to: string; subject: string; html: string; text: string };

const okInvite = vi.fn(async (_payload: InvitePayload) => ({ ok: true as const, messageId: "gmail-1" }));

beforeEach(() => {
  vi.clearAllMocks();
  getPlatformAdminAccess.mockResolvedValue(null);
  createAdminClient.mockReturnValue(makeAdmin() as unknown as SupabaseClient<Database>);
  createServerClient.mockReset();
  okInvite.mockResolvedValue({ ok: true, messageId: "gmail-1" });
});

describe("authorization boundary", () => {
  it("blocks every write when the caller is not a platform admin", async () => {
    const admin = makeAdmin();
    createAdminClient.mockReturnValue(admin);

    const results = await Promise.all([
      createAdminClientAccountAction(VALID_INPUT, { admin: admin, sendInvite: okInvite }),
      resendAdminClientAccountInviteAction({ client_account_id: ACCOUNT_ID }, { admin: admin }),
      setAdminClientAccountSuspendedAction(
        { client_account_id: ACCOUNT_ID, suspended: true },
        { admin: admin }
      ),
    ]);

    for (const result of results) {
      expect(result).toEqual({ ok: false, error: "forbidden" });
    }
    // No provisioning side effect may occur for an unauthorized caller.
    expect(admin.state.accounts).toHaveLength(0);
    expect(admin.state.events).toHaveLength(0);
    expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();
  });

  it("fails closed when the service role is unavailable", async () => {
    authorizeAdmin();
    createAdminClient.mockReturnValue(null);

    const result = await createAdminClientAccountAction(VALID_INPUT);
    expect(result).toEqual({ ok: false, error: "service_role_unavailable" });
  });

  it("rejects invalid payloads before touching Supabase Auth", async () => {
    authorizeAdmin();
    const admin = makeAdmin();

    const result = await createAdminClientAccountAction(
      { full_name: "", email: "nao-e-email", org_id: "not-a-uuid" },
      { admin: admin }
    );

    expect(result).toEqual({ ok: false, error: "validation_failed" });
    expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();
  });
});

describe("create account + invite", () => {
  it("creates the account, sends the invitation and records the audit trail", async () => {
    authorizeAdmin();
    const admin = makeAdmin();

    const result = await createAdminClientAccountAction(VALID_INPUT, {
      admin,
      env: { ...GMAIL_ENV, APP_ORIGIN: "https://app.nexgestaovendas.com.br" },
      sendInvite: okInvite,
      now: () => NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inviteSent).toBe(true);
    expect(result.status).toBe("invite_sent");

    // Invitation goes through the Supabase admin invite flow, not a password.
    expect(admin.auth.admin.generateLink).toHaveBeenCalledWith(
      expect.objectContaining({ type: "invite", email: "maria@empresa.com.br" })
    );

    // Exactly one e-mail, containing the activation link.
    expect(okInvite).toHaveBeenCalledTimes(1);
    const inviteArg = okInvite.mock.calls[0][0];
    expect(inviteArg.to).toBe("maria@empresa.com.br");
    expect(inviteArg.html).toContain("https://app.nexgestaovendas.com.br/auth/v1/verify");

    // Audit trail: creation + delivery, with the acting admin recorded.
    expect(admin.state.events.map((e) => e.event_type)).toEqual([
      "account_created",
      "invite_sent",
    ]);
    expect(admin.state.events[0].actor_user_id).toBe(ADMIN_ID);

    // Expiry is recorded as a timestamp, never a token.
    const account = admin.state.accounts[0];
    expect(account.status).toBe("invite_sent");
    expect(account.last_error).toBe("");
    expect(account.invite_expires_at).toBe(
      new Date(NOW + CLIENT_ACCOUNT_INVITE_TTL_MS).toISOString()
    );
    expect(JSON.stringify(admin.state)).not.toContain("secret-token");

    // Tenant access: profile + MATRIZ store + store membership for RLS.
    expect(admin.state.profiles).toHaveLength(1);
    expect(admin.state.profiles[0]).toMatchObject({
      id: USER_ID,
      org_id: ORG_ID,
      email: "maria@empresa.com.br",
      default_role: "admin",
    });
    expect(admin.state.stores).toHaveLength(1);
    expect(admin.state.stores[0]).toMatchObject({
      org_id: ORG_ID,
      code: "MATRIZ",
      name: "Souza Varejo",
    });
    expect(admin.state.storeMembers).toHaveLength(1);
    expect(admin.state.storeMembers[0]).toMatchObject({
      org_id: ORG_ID,
      user_id: USER_ID,
      role: "admin",
    });
  });

  it("never sets a password on the auth user", async () => {
    authorizeAdmin();
    const admin = makeAdmin();

    await createAdminClientAccountAction(VALID_INPUT, {
      admin,
      env: { ...GMAIL_ENV, APP_ORIGIN: "https://app.nexgestaovendas.com.br" },
      sendInvite: okInvite,
      now: () => NOW,
    });

    const updateUserCalls = admin.auth.admin.updateUserById.mock.calls;
    // Only a ban toggle may ever use updateUserById, and never with a password.
    for (const call of updateUserCalls) {
      expect(JSON.stringify(call)).not.toContain("password");
    }
  });

  it("rejects a subscription that belongs to another organization", async () => {
    authorizeAdmin();
    const admin = makeAdmin();
    admin.state.accounts.push({
      id: ACCOUNT_ID,
      org_id: ORG_ID,
      subscription_id: null,
      email: "maria@empresa.com.br",
      full_name: "Maria Souza",
      company_name: "",
      status: "created",
    });

    const result = await createAdminClientAccountAction(
      { ...VALID_INPUT, subscription_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
      { admin: admin, env: GMAIL_ENV, sendInvite: okInvite }
    );

    expect(result).toEqual({ ok: false, error: "subscription_not_found" });
    expect(okInvite).not.toHaveBeenCalled();
  });

  it("refuses an unknown organization", async () => {
    authorizeAdmin();
    const admin = makeAdmin();
    const result = await createAdminClientAccountAction(
      { ...VALID_INPUT, org_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
      { admin: admin, env: GMAIL_ENV, sendInvite: okInvite }
    );

    expect(result).toEqual({ ok: false, error: "organization_not_found" });
    expect(okInvite).not.toHaveBeenCalled();
  });
});

describe("idempotency and partial failures", () => {
  it("never provisions a second account for the same e-mail", async () => {
    authorizeAdmin();
    const admin = makeAdmin();
    const deps = {
      admin,
      env: { ...GMAIL_ENV, APP_ORIGIN: "https://app.nexgestaovendas.com.br" },
      sendInvite: okInvite,
      now: () => NOW,
    };

    await createAdminClientAccountAction(VALID_INPUT, deps);
    const second = await createAdminClientAccountAction(VALID_INPUT, deps);

    expect(second.ok).toBe(true);
    expect(admin.state.accounts).toHaveLength(1);
    // A repeat request only retries delivery.
    expect(okInvite).toHaveBeenCalledTimes(2);
    expect(admin.auth.admin.generateLink).toHaveBeenCalledTimes(2);
  });

  it("treats the e-mail comparison case-insensitively for duplicates", async () => {
    authorizeAdmin();
    const admin = makeAdmin();
    const deps = { admin: admin, env: GMAIL_ENV, sendInvite: okInvite };

    await createAdminClientAccountAction(VALID_INPUT, deps);
    await createAdminClientAccountAction({ ...VALID_INPUT, email: "MARIA@Empresa.com.br" }, deps);

    expect(admin.state.accounts).toHaveLength(1);
  });

  it("keeps the account when the e-mail send fails, allowing a safe resend", async () => {
    authorizeAdmin();
    const admin = makeAdmin();
    const failing = vi.fn(async (_payload: InvitePayload) => ({
      ok: false as const,
      error: "gmail_invite_send_failed_status_500",
    }));

    const result = await createAdminClientAccountAction(VALID_INPUT, {
      admin,
      env: { ...GMAIL_ENV, APP_ORIGIN: "https://app.nexgestaovendas.com.br" },
      sendInvite: failing,
      now: () => NOW,
    });

    expect(result).toEqual({ ok: false, error: "invite_send_failed" });
    // The account survives the delivery failure — no orphan cleanup, no duplicate.
    expect(admin.state.accounts).toHaveLength(1);
    expect(admin.state.accounts[0].status).toBe("invite_failed");
    expect(admin.state.events.map((e) => e.event_type)).toContain("invite_failed");

    // Retry re-sends without creating another account.
    const retry = await resendAdminClientAccountInviteAction(
      { client_account_id: admin.state.accounts[0].id as string },
      { admin: admin, env: { ...GMAIL_ENV, APP_ORIGIN: "https://app.nexgestaovendas.com.br" }, sendInvite: okInvite, now: () => NOW }
    );

    expect(retry.ok).toBe(true);
    expect(admin.state.accounts).toHaveLength(1);
    expect(admin.state.events.map((e) => e.event_type)).toContain("invite_resent");
  });

  it("fails closed with a typed reason when Gmail is not configured", async () => {
    authorizeAdmin();
    const admin = makeAdmin();

    const result = await createAdminClientAccountAction(VALID_INPUT, {
      admin,
      env: { APP_ORIGIN: "https://app.nexgestaovendas.com.br" },
      sendInvite: okInvite,
      now: () => NOW,
    });

    expect(result).toEqual({ ok: false, error: "gmail_not_configured" });
    expect(okInvite).not.toHaveBeenCalled();
    expect(admin.state.accounts[0].status).toBe("invite_failed");
  });

  it("can provision without sending the invitation", async () => {
    authorizeAdmin();
    const admin = makeAdmin();

    const result = await createAdminClientAccountAction(
      { ...VALID_INPUT, send_invite: false },
      { admin: admin, env: GMAIL_ENV, sendInvite: okInvite, now: () => NOW }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.inviteSent).toBe(false);
      expect(result.status).toBe("created");
    }
    expect(okInvite).not.toHaveBeenCalled();
    expect(admin.state.events.map((e) => e.event_type)).toEqual(["account_created"]);
  });
});

describe("resend", () => {
  it("regenerates the link and never reuses a stale one", async () => {
    authorizeAdmin();
    const admin = makeAdmin();
    admin.state.accounts.push({
      id: ACCOUNT_ID,
      user_id: USER_ID,
      org_id: ORG_ID,
      subscription_id: SUB_ID,
      email: "maria@empresa.com.br",
      full_name: "Maria Souza",
      company_name: "Souza Varejo",
      status: "invite_expired",
      last_error: "",
    });

    const result = await resendAdminClientAccountInviteAction(
      { client_account_id: ACCOUNT_ID },
      { admin: admin, env: { ...GMAIL_ENV, APP_ORIGIN: "https://app.nexgestaovendas.com.br" }, sendInvite: okInvite, now: () => NOW }
    );

    expect(result.ok).toBe(true);
    expect(admin.state.accounts[0].status).toBe("invite_sent");
    expect(admin.auth.admin.generateLink).toHaveBeenCalledTimes(1);
    expect(admin.state.events.map((e) => e.event_type)).toEqual(["invite_resent"]);
  });

  it("refuses to resend to an activated or suspended account", async () => {
    authorizeAdmin();
    for (const status of ["activated", "suspended"]) {
      const admin = makeAdmin();
      admin.state.accounts.push({
        id: ACCOUNT_ID,
        user_id: USER_ID,
        org_id: ORG_ID,
        email: "maria@empresa.com.br",
        full_name: "Maria Souza",
        company_name: "",
        status,
      });

      const result = await resendAdminClientAccountInviteAction(
        { client_account_id: ACCOUNT_ID },
        { admin: admin, env: GMAIL_ENV, sendInvite: okInvite }
      );

      expect(result).toEqual({ ok: false, error: "account_not_resendable" });
      expect(okInvite).not.toHaveBeenCalled();
    }
  });

  it("reports an unknown account without leaking details", async () => {
    authorizeAdmin();
    const admin = makeAdmin();
    const result = await resendAdminClientAccountInviteAction(
      { client_account_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
      { admin: admin, env: GMAIL_ENV, sendInvite: okInvite }
    );
    expect(result).toEqual({ ok: false, error: "account_not_found" });
  });
});

describe("suspension", () => {
  it("suspends and reactivates through the Supabase Auth ban mechanism", async () => {
    authorizeAdmin();
    const admin = makeAdmin();
    admin.state.accounts.push({
      id: ACCOUNT_ID,
      user_id: USER_ID,
      org_id: ORG_ID,
      email: "maria@empresa.com.br",
      full_name: "Maria Souza",
      company_name: "",
      status: "activated",
      activated_at: "2026-10-05T09:00:00.000Z",
    });

    const suspend = await setAdminClientAccountSuspendedAction(
      { client_account_id: ACCOUNT_ID, suspended: true },
      { admin: admin, now: () => NOW }
    );
    expect(suspend.ok).toBe(true);
    expect(admin.state.bans).toEqual([{ userId: USER_ID, banDuration: "876000h" }]);
    expect(admin.state.accounts[0].status).toBe("suspended");
    expect(admin.state.accounts[0].suspended_at).toBe(new Date(NOW).toISOString());

    const reactivate = await setAdminClientAccountSuspendedAction(
      { client_account_id: ACCOUNT_ID, suspended: false },
      { admin: admin, now: () => NOW }
    );
    expect(reactivate.ok).toBe(true);
    expect(admin.state.bans[1]).toEqual({ userId: USER_ID, banDuration: "none" });
    expect(admin.state.accounts[0].status).toBe("invite_sent");
    expect(admin.state.events.map((e) => e.event_type)).toEqual([
      "account_suspended",
      "account_reactivated",
    ]);
  });

  it("never changes subscription or payment state", async () => {
    authorizeAdmin();
    const admin = makeAdmin();
    admin.state.accounts.push({
      id: ACCOUNT_ID,
      user_id: USER_ID,
      org_id: ORG_ID,
      subscription_id: SUB_ID,
      email: "maria@empresa.com.br",
      full_name: "Maria Souza",
      company_name: "",
      status: "activated",
    });

    await setAdminClientAccountSuspendedAction(
      { client_account_id: ACCOUNT_ID, suspended: true },
      { admin: admin, now: () => NOW }
    );

    // Only client_accounts was ever written; no subscription or plan row was
    // touched by a suspension.
    expect(new Set(admin.state.updates.map((u) => u.table))).toEqual(
      new Set(["client_accounts"])
    );
  });

  it("rejects a redundant state change", async () => {
    authorizeAdmin();
    const admin = makeAdmin();
    admin.state.accounts.push({
      id: ACCOUNT_ID,
      user_id: USER_ID,
      org_id: ORG_ID,
      email: "maria@empresa.com.br",
      full_name: "Maria Souza",
      company_name: "",
      status: "suspended",
    });

    const result = await setAdminClientAccountSuspendedAction(
      { client_account_id: ACCOUNT_ID, suspended: true },
      { admin: admin }
    );
    expect(result).toEqual({ ok: false, error: "suspension_not_supported" });
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
  });
});

describe("activation marking", () => {
  it("marks the account activated for the recovering session user", async () => {
    getPlatformAdminAccess.mockResolvedValue(null);
    const admin = makeAdmin();
    admin.state.accounts.push({
      id: ACCOUNT_ID,
      user_id: USER_ID,
      org_id: ORG_ID,
      email: "maria@empresa.com.br",
      full_name: "Maria Souza",
      company_name: "",
      status: "invite_sent",
    });

    withSessionUser({ id: USER_ID, email: "maria@empresa.com.br" });

    const result = await markClientAccountActivatedAction({ admin: admin, now: () => NOW });

    expect(result).toEqual({ ok: true, clientAccountId: ACCOUNT_ID });
    expect(admin.state.accounts[0].status).toBe("activated");
    expect(admin.state.accounts[0].activated_at).toBe(new Date(NOW).toISOString());
    expect(admin.state.events.map((e) => e.event_type)).toEqual(["account_activated"]);
  });

  it("refuses when there is no recovering session", async () => {
    const admin = makeAdmin();
    withSessionUser(null);

    const result = await markClientAccountActivatedAction({ admin: admin });
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(admin.state.accounts).toHaveLength(0);
  });
});

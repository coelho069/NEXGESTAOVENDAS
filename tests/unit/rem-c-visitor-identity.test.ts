import { beforeEach, describe, expect, it, vi } from "vitest";
import { runVisitorOnboarding } from "@/lib/server/visitor-onboarding";

/**
 * Remediation C1 (P0): identity on the anonymous public checkout.
 * Synthetic data only: fake admin, mocked session/claim/email/link layers.
 */

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  claim: vi.fn(),
  save: vi.fn(),
  getEmailConfig: vi.fn(),
  sendEmail: vi.fn(),
  generateAccessLink: vi.fn(),
  syncClientAccount: vi.fn(),
}));

vi.mock("@/lib/server/public-checkout-sessions", () => ({
  resolveSessionForOnboarding: mocks.resolve,
  claimPublicCheckoutSession: mocks.claim,
  savePublicCheckoutSessionProgress: mocks.save,
}));

vi.mock("@/lib/server/access-email", () => ({
  getEmailSenderConfig: mocks.getEmailConfig,
  sendAccessEmail: mocks.sendEmail,
}));

vi.mock("@/lib/server/access-link", () => ({
  ACCESS_LINK_TTL_MS: 86_400_000,
  generateAccessLink: mocks.generateAccessLink,
}));

vi.mock("@/lib/server/client-account-sync", () => ({
  syncClientAccountAfterPurchase: mocks.syncClientAccount,
  markClientAccountAccessEmailSent: vi.fn(async () => {}),
  markClientAccountAccessEmailFailed: vi.fn(async () => {}),
}));

const VICTIM_EMAIL = "vitima@exemplo.test";
const VICTIM_ID = "a0000000-0000-4000-8000-000000000001";
const VICTIM_ORG = "a0000000-0000-4000-8000-0000000000a1";
const VICTIM_STORE = "a0000000-0000-4000-8000-0000000000b1";
const VICTIM_SUB = "a0000000-0000-4000-8000-0000000000c1";
const PLAN_OLD = "a0000000-0000-4000-8000-0000000000d1";
const PLAN_NEW = "a0000000-0000-4000-8000-0000000000d2";
const MUTATION = "b0000000-0000-4000-8000-000000000002";

type Row = Record<string, unknown>;
type Mutation = { table: string; op: "insert" | "update" | "delete"; payload?: Row };

type Harness = ReturnType<typeof createHarness>;

function createHarness() {
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${String(++seq).padStart(4, "0")}`;
  const authUsers: Array<{ id: string; email: string; email_confirmed_at: string | null }> = [];
  const mutations: Mutation[] = [];
  const db: Record<string, Row[]> = {
    plans: [],
    profiles: [],
    organizations: [],
    stores: [],
    store_members: [],
    subscriptions: [],
  };

  function from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let mode: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row = {};
    let executed: { data: unknown; error: null } | null = null;
    const rows = () => (db[table] ?? []).filter((row) => filters.every((f) => f(row)));

    const exec = () => {
      if (executed) return executed;
      if (mode === "insert") {
        const row: Row = { id: nextId(table), ...payload };
        db[table].push(row);
        mutations.push({ table, op: "insert", payload });
        executed = { data: row, error: null };
      } else if (mode === "update") {
        rows().forEach((row) => Object.assign(row, payload));
        mutations.push({ table, op: "update", payload });
        executed = { data: null, error: null };
      } else if (mode === "delete") {
        const matched = rows();
        db[table] = db[table].filter((row) => !matched.includes(row));
        mutations.push({ table, op: "delete" });
        executed = { data: null, error: null };
      } else {
        executed = { data: rows(), error: null };
      }
      return executed;
    };

    const builder = {
      select() {
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return builder;
      },
      in(column: string, values: unknown[]) {
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      insert(values: Row) {
        mode = "insert";
        payload = values;
        return builder;
      },
      update(values: Row) {
        mode = "update";
        payload = values;
        return builder;
      },
      delete() {
        mode = "delete";
        return builder;
      },
      maybeSingle() {
        const result = exec();
        const list = Array.isArray(result.data) ? result.data : [result.data];
        return Promise.resolve({ data: list[0] ?? null, error: null });
      },
      single() {
        const result = exec();
        return Promise.resolve({ data: result.data, error: null });
      },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(exec()).then(resolve, reject);
      },
    };
    return builder;
  }

  const admin = {
    auth: {
      admin: {
        listUsers: vi.fn(async ({ page }: { page: number }) => ({
          data: { users: page === 1 ? authUsers.map((u) => ({ ...u })) : [] },
          error: null,
        })),
        getUserById: vi.fn(async (id: string) => {
          const user = authUsers.find((u) => u.id === id);
          return user
            ? { data: { user }, error: null }
            : { data: { user: null }, error: { message: "not_found" } };
        }),
      },
    },
    from,
  };

  return { admin, db, authUsers, mutations, nextId };
}

/** Victim: existing client-of-subscription in org O, with an open subscription paid by the victim. */
function seedVictim(h: Harness, role: "owner" | "manager" | "client", confirmed = true) {
  h.authUsers.push({
    id: VICTIM_ID,
    email: VICTIM_EMAIL,
    email_confirmed_at: confirmed ? "2026-01-01T00:00:00.000Z" : null,
  });
  h.db.plans.push(
    { id: PLAN_OLD, name: "Básico", amount: 99.9, currency: "BRL", billing_interval: "monthly" },
    { id: PLAN_NEW, name: "Profissional", amount: 199.9, currency: "BRL", billing_interval: "monthly" }
  );
  h.db.organizations.push({ id: VICTIM_ORG, name: "Org da vítima" });
  h.db.profiles.push({ id: VICTIM_ID, org_id: VICTIM_ORG, email: VICTIM_EMAIL, default_role: role });
  h.db.stores.push({ id: VICTIM_STORE, org_id: VICTIM_ORG, code: "MATRIZ", name: "Loja principal" });
  h.db.store_members.push({
    id: "member-victim",
    org_id: VICTIM_ORG,
    store_id: VICTIM_STORE,
    user_id: VICTIM_ID,
    role,
  });
  h.db.subscriptions.push({
    id: VICTIM_SUB,
    org_id: VICTIM_ORG,
    plan_id: PLAN_OLD,
    status: "active",
    period_start: "2026-10-01",
    period_end: "2026-10-31",
    created_at: "2026-10-01T12:00:00.000Z",
    mp_preapproval_id: "pre-victim-old",
    mp_payer_email: VICTIM_EMAIL,
    checkout_client_mutation_id: "c0000000-0000-4000-8000-000000000001",
    contracted_amount: 99.9,
    currency: "BRL",
  });
}

function sessionState(overrides: Row): Row {
  return {
    id: "session-1",
    client_mutation_id: MUTATION,
    plan_id: PLAN_NEW,
    payer_email: VICTIM_EMAIL,
    status: "pending",
    onboarding_status: null,
    onboarding_organization_id: null,
    onboarding_user_id: null,
    onboarding_subscription_id: null,
    onboarding_email_sent_at: null,
    onboarding_completed_at: null,
    onboarding_error: null,
    created_at: "2026-10-16T12:00:00.000Z",
    updated_at: "2026-10-16T12:00:00.000Z",
    mp_preapproval_id: null,
    onboarding_claim_token: null,
    onboarding_claimed_at: null,
    onboarding_attempt_count: 0,
    ...overrides,
  };
}

function wireMocks(h: Harness, session: Row) {
  mocks.resolve.mockImplementation(async () => ({ ok: true, session }));
  mocks.claim.mockImplementation(async () => {
    session.onboarding_status = "in_progress";
    return { ok: true, status: "claimed", claimToken: "token-1", session };
  });
  mocks.save.mockImplementation(async (input: Record<string, unknown>) => {
    if (input.userId) session.onboarding_user_id = input.userId;
    if (input.organizationId) session.onboarding_organization_id = input.organizationId;
    if (input.subscriptionId) session.onboarding_subscription_id = input.subscriptionId;
    if (input.onboardingError) {
      session.onboarding_status = "failed";
      session.onboarding_error = input.onboardingError;
    }
    if (input.complete) {
      session.onboarding_status = "completed";
      session.onboarding_error = null;
    }
    return { ok: true, status: input.complete ? "completed" : "pending", replay: false, session };
  });
  mocks.getEmailConfig.mockReturnValue({ configured: false, reason: "email_not_configured" });
  mocks.sendEmail.mockResolvedValue({ ok: true, emailId: "email-1" });
  mocks.syncClientAccount.mockResolvedValue({
    ok: true,
    clientAccountId: "account-1",
    created: true,
    status: "created",
  });
  mocks.generateAccessLink.mockImplementation(async (_admin: unknown, input: { email: string }) => {
    const existing = h.authUsers.find((u) => u.email === input.email);
    if (existing) {
      return {
        ok: true,
        actionLink: "https://app.example.test/recovery",
        userId: existing.id,
        linkType: "recovery",
      };
    }
    const id = h.nextId("new-user");
    h.authUsers.push({ id, email: input.email, email_confirmed_at: null });
    return {
      ok: true,
      actionLink: "https://app.example.test/invite",
      userId: id,
      linkType: "invite",
    };
  });
}

function identityMutations(h: Harness) {
  return h.mutations.filter((m) =>
    ["subscriptions", "profiles", "store_members"].includes(m.table)
  );
}

function run(h: Harness, session: Row, depsEnv = true) {
  return runVisitorOnboarding({
    clientMutationId: MUTATION,
    providerRef: "pre-new-1",
    paidAt: "2026-10-16T12:00:00.000Z",
    correlationId: "corr-rem-c",
    depsOverride: {
      admin: h.admin as never,
      env: depsEnv ? { APP_ORIGIN: "https://app.example.test" } : {},
    },
  });
}

describe("C1: identidade no checkout publico sem ancora de renovacao", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("e-mail digitado de terceiro (conta de dono) nao altera assinatura, perfil, membership nem papel", async () => {
    const h = createHarness();
    seedVictim(h, "owner");
    const session = sessionState({});
    wireMocks(h, session);

    const result = await run(h, session);

    expect(result.status).toBe("failed");
    expect(session.onboarding_error).toBe("onboarding_manual_review_required");
    expect(identityMutations(h)).toEqual([]);
    expect(mocks.generateAccessLink).not.toHaveBeenCalled();
    const victimSub = h.db.subscriptions.find((s) => s.id === VICTIM_SUB);
    expect(victimSub?.plan_id).toBe(PLAN_OLD);
    expect(h.db.profiles[0]?.org_id).toBe(VICTIM_ORG);
    expect(h.db.store_members[0]?.role).toBe("owner");
  });

  it("conta existente de gerente sem ancora nao sofre troca de org nem remocao de store_members", async () => {
    const h = createHarness();
    seedVictim(h, "manager");
    // Outra assinatura aberta na org da vítima, de outro checkout: antes isso levava a troca de org.
    h.db.subscriptions.push({
      id: "a0000000-0000-4000-8000-0000000000c2",
      org_id: VICTIM_ORG,
      plan_id: PLAN_OLD,
      status: "active",
      period_start: "2026-10-01",
      period_end: "2026-10-31",
      created_at: "2026-10-02T12:00:00.000Z",
      mp_preapproval_id: "pre-other-checkout",
      mp_payer_email: "outro@exemplo.test",
      checkout_client_mutation_id: "c0000000-0000-4000-8000-000000000009",
      contracted_amount: 99.9,
      currency: "BRL",
    });
    const session = sessionState({});
    wireMocks(h, session);

    const result = await run(h, session);

    expect(result.status).toBe("failed");
    expect(identityMutations(h)).toEqual([]);
    expect(h.db.profiles[0]?.org_id).toBe(VICTIM_ORG);
    expect(h.db.store_members.find((m) => m.id === "member-victim")?.role).toBe("manager");
    expect(h.db.organizations).toHaveLength(1);
  });

  it("conta existente sem e-mail confirmado tambem nao e vinculada", async () => {
    const h = createHarness();
    seedVictim(h, "owner", false);
    const session = sessionState({});
    wireMocks(h, session);

    const result = await run(h, session);

    expect(result.status).toBe("failed");
    expect(identityMutations(h)).toEqual([]);
    expect(mocks.generateAccessLink).not.toHaveBeenCalled();
  });

  it("renovacao logada com ancora continua estendendo a mesma org e assinatura", async () => {
    const h = createHarness();
    seedVictim(h, "owner");
    const session = sessionState({
      onboarding_user_id: VICTIM_ID,
      onboarding_organization_id: VICTIM_ORG,
    });
    wireMocks(h, session);

    const result = await run(h, session);

    expect(result).toMatchObject({
      status: "completed",
      organizationId: VICTIM_ORG,
      userId: VICTIM_ID,
      subscriptionId: VICTIM_SUB,
    });
    expect(h.db.subscriptions.find((s) => s.id === VICTIM_SUB)?.plan_id).toBe(PLAN_NEW);
    expect(h.db.organizations).toHaveLength(1);
    expect(mocks.generateAccessLink).not.toHaveBeenCalled();
  });

  it("evento repetido da renovacao e idempotente e nao muta de novo", async () => {
    const h = createHarness();
    seedVictim(h, "owner");
    const session = sessionState({
      onboarding_user_id: VICTIM_ID,
      onboarding_organization_id: VICTIM_ORG,
    });
    wireMocks(h, session);

    await run(h, session);
    const mutationsAfterFirst = h.mutations.length;
    const second = await run(h, session);

    expect(second.status).toBe("replayed");
    expect(h.mutations.length).toBe(mutationsAfterFirst);
  });

  it("visitante novo sem conta existente continua provisionando normalmente", async () => {
    const h = createHarness();
    h.db.plans.push({
      id: PLAN_NEW,
      name: "Profissional",
      amount: 199.9,
      currency: "BRL",
      billing_interval: "monthly",
    });
    const session = sessionState({ payer_email: "novo@exemplo.test" });
    wireMocks(h, session);

    const result = await run(h, session);

    expect(result.status).toBe("completed");
    expect(h.db.organizations).toHaveLength(1);
    expect(h.db.subscriptions).toHaveLength(1);
    expect(h.db.subscriptions[0]?.org_id).toBe(h.db.organizations[0]?.id);
  });
});

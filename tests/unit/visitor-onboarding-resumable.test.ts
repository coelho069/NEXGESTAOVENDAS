import { beforeEach, describe, expect, it, vi } from "vitest";
import { runVisitorOnboarding } from "@/lib/server/visitor-onboarding";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  claim: vi.fn(),
  save: vi.fn(),
  getEmailConfig: vi.fn(),
  sendEmail: vi.fn(),
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

const MUTATION = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const ORG_ID = "44444444-4444-4444-8444-444444444444";
const SUBSCRIPTION_ID = "55555555-5555-4555-8555-555555555555";

type OnboardingState = {
  session: Record<string, unknown>;
  userExists: boolean;
  profileExists: boolean;
  orgExists: boolean;
  storeExists: boolean;
  memberExists: boolean;
  subscriptionExists: boolean;
  failAt: "organization" | "profile" | "subscription" | "email" | null;
  claimBusy: boolean;
};

function createState(): OnboardingState {
  return {
    session: {
      id: "session-1",
      client_mutation_id: MUTATION,
      plan_id: "11111111-1111-4111-8111-111111111111",
      payer_email: "cliente@exemplo.com",
      status: "pending",
      onboarding_status: null,
      onboarding_organization_id: null,
      onboarding_user_id: null,
      onboarding_subscription_id: null,
      onboarding_email_sent_at: null,
      onboarding_completed_at: null,
      onboarding_error: null,
      created_at: "2026-09-18T12:00:00.000Z",
      updated_at: "2026-09-18T12:00:00.000Z",
      mp_preapproval_id: null,
      onboarding_claim_token: null,
      onboarding_claimed_at: null,
      onboarding_attempt_count: 0,
    },
    userExists: false,
    profileExists: false,
    orgExists: false,
    storeExists: false,
    memberExists: false,
    subscriptionExists: false,
    failAt: null,
    claimBusy: false,
  };
}

function createAdmin(state: OnboardingState) {
  return {
    auth: {
      admin: {
        listUsers: vi.fn(async () => ({
          data: {
            users: state.userExists
              ? [{ id: USER_ID, email: "cliente@exemplo.com" }]
              : [],
          },
          error: null,
        })),
        createUser: vi.fn(async () => {
          state.userExists = true;
          return { data: { user: { id: USER_ID } }, error: null };
        }),
        updateUserById: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })),
      },
    },
    from(table: string) {
      let insertPayload: Record<string, unknown> | null = null;
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        insert(payload: Record<string, unknown>) {
          insertPayload = payload;
          return builder;
        },
        maybeSingle() {
          if (table === "plans") {
            return Promise.resolve({
              data: {
                id: "11111111-1111-4111-8111-111111111111",
                name: "Profissional",
                amount: 199.9,
                currency: "BRL",
                billing_interval: "monthly",
              },
              error: null,
            });
          }
          if (table === "profiles") {
            return Promise.resolve({
              data: state.profileExists ? { org_id: ORG_ID } : null,
              error: null,
            });
          }
          if (table === "stores") {
            return Promise.resolve({
              data: state.storeExists ? { id: "store-1" } : null,
              error: null,
            });
          }
          if (table === "store_members") {
            return Promise.resolve({
              data: state.memberExists ? { id: "member-1" } : null,
              error: null,
            });
          }
          if (table === "subscriptions") {
            return Promise.resolve({
              data: state.subscriptionExists
                ? {
                    id: SUBSCRIPTION_ID,
                    org_id: ORG_ID,
                    checkout_client_mutation_id: MUTATION,
                    mp_preapproval_id: "preapproval-1",
                  }
                : null,
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        single() {
          if (table === "organizations") {
            if (state.failAt === "organization") {
              return Promise.resolve({ data: null, error: { code: "23505" } });
            }
            state.orgExists = true;
            return Promise.resolve({ data: { id: ORG_ID }, error: null });
          }
          if (table === "stores") {
            state.storeExists = true;
            return Promise.resolve({ data: { id: "store-1" }, error: null });
          }
          if (table === "subscriptions") {
            if (state.failAt === "subscription") {
              return Promise.resolve({ data: null, error: { code: "23505" } });
            }
            state.subscriptionExists = true;
            return Promise.resolve({ data: { id: SUBSCRIPTION_ID }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(
          onFulfilled: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) {
          if (table === "profiles") {
            if (state.failAt === "profile") {
              return Promise.resolve({ data: null, error: { code: "23505" } }).then(
                onFulfilled,
                onRejected
              );
            }
            state.profileExists = true;
          }
          if (table === "store_members") state.memberExists = true;
          void insertPayload;
          return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  };
}

function configureMocks(state: OnboardingState) {
  mocks.getEmailConfig.mockReturnValue({
    configured: true,
    apiKey: "test-key",
    from: "no-reply@example.com",
    timeoutMs: 1_000,
  });
  mocks.sendEmail.mockImplementation(async () =>
    state.failAt === "email"
      ? { ok: false, error: "access_email_send_failed_status_500" }
      : { ok: true, emailId: "email-1" }
  );
  mocks.resolve.mockImplementation(async () => ({
    ok: true,
    session: state.session,
  }));
  mocks.claim.mockImplementation(async ({ session }: { session: Record<string, unknown> }) => {
    if (state.claimBusy) {
      return { ok: false, status: "busy", error: "checkout_session_claim_busy" };
    }
    if (session.onboarding_status === "completed") {
      return {
        ok: true,
        status: "completed",
        replay: true,
        claimToken: null,
        session,
      };
    }
    state.session = { ...state.session, onboarding_status: "in_progress" };
    return {
      ok: true,
      status: "claimed",
      replay: false,
      claimToken: "claim-1",
      session: state.session,
    };
  });
  mocks.save.mockImplementation(
    async (input: {
      organizationId?: string | null;
      userId?: string | null;
      subscriptionId?: string | null;
      emailSent?: boolean;
      complete?: boolean;
      onboardingError?: string | null;
    }) => {
      state.session = {
        ...state.session,
        onboarding_organization_id:
          input.organizationId ?? state.session.onboarding_organization_id,
        onboarding_user_id: input.userId ?? state.session.onboarding_user_id,
        onboarding_subscription_id:
          input.subscriptionId ?? state.session.onboarding_subscription_id,
        onboarding_email_sent_at:
          input.emailSent ? "2026-09-18T12:30:00.000Z" : state.session.onboarding_email_sent_at,
        onboarding_status: input.complete
          ? "completed"
          : input.onboardingError
            ? "failed"
            : "in_progress",
        status: input.complete ? "onboarded" : input.onboardingError ? "failed" : "pending",
        onboarding_error: input.onboardingError ?? state.session.onboarding_error,
      };
      return {
        ok: true,
        status: input.complete
          ? "completed"
          : input.onboardingError
            ? "failed"
            : "in_progress",
        replay: false,
        session: state.session,
      };
    }
  );
}

describe("resumable visitor onboarding", () => {
  beforeEach(() => {
    mocks.resolve.mockReset();
    mocks.claim.mockReset();
    mocks.save.mockReset();
    mocks.getEmailConfig.mockReset();
    mocks.sendEmail.mockReset();
  });

  it("reuses the user and organization after a partial organization failure", async () => {
    const state = createState();
    state.failAt = "organization";
    configureMocks(state);
    const admin = createAdmin(state);

    const first = await runVisitorOnboarding({
      clientMutationId: MUTATION,
      providerRef: "preapproval-1",
      depsOverride: {
        admin: admin as never,
        env: {
          RESEND_API_KEY: "test-key",
          EMAIL_FROM: "no-reply@example.com",
          SUPABASE_SERVICE_ROLE_KEY: "stable-test-secret",
        },
      },
    });
    expect(first.status).toBe("failed");
    expect(state.session.onboarding_user_id).toBe(USER_ID);

    state.failAt = null;
    const second = await runVisitorOnboarding({
      clientMutationId: MUTATION,
      providerRef: "preapproval-1",
      depsOverride: {
        admin: admin as never,
        env: {
          RESEND_API_KEY: "test-key",
          EMAIL_FROM: "no-reply@example.com",
          SUPABASE_SERVICE_ROLE_KEY: "stable-test-secret",
        },
      },
    });

    expect(second.status).toBe("completed");
    expect(admin.auth.admin.createUser).toHaveBeenCalledTimes(1);
    expect(state.session.onboarding_organization_id).toBe(ORG_ID);
    expect(state.session.onboarding_subscription_id).toBe(SUBSCRIPTION_ID);
  });

  it("reuses a created subscription and sends access only once after email retry", async () => {
    const state = createState();
    state.failAt = "email";
    configureMocks(state);
    const admin = createAdmin(state);
    const depsOverride = {
      admin: admin as never,
      env: {
        RESEND_API_KEY: "test-key",
        EMAIL_FROM: "no-reply@example.com",
        SUPABASE_SERVICE_ROLE_KEY: "stable-test-secret",
      },
    };

    const first = await runVisitorOnboarding({
      clientMutationId: MUTATION,
      providerRef: "preapproval-1",
      depsOverride,
    });
    expect(first.status).toBe("failed");
    expect(state.subscriptionExists).toBe(true);

    state.failAt = null;
    const second = await runVisitorOnboarding({
      clientMutationId: MUTATION,
      providerRef: "preapproval-1",
      depsOverride,
    });
    const third = await runVisitorOnboarding({
      clientMutationId: MUTATION,
      providerRef: "preapproval-1",
      depsOverride,
    });

    expect(second.status).toBe("completed");
    expect(third.status).toBe("replayed");
    expect(admin.auth.admin.createUser).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    expect(state.session.onboarding_email_sent_at).not.toBeNull();
  });

  it("does not provision when another webhook owns the claim", async () => {
    const state = createState();
    state.claimBusy = true;
    configureMocks(state);
    const admin = createAdmin(state);

    const result = await runVisitorOnboarding({
      clientMutationId: MUTATION,
      providerRef: "preapproval-1",
      depsOverride: {
        admin: admin as never,
        env: {
          RESEND_API_KEY: "test-key",
          EMAIL_FROM: "no-reply@example.com",
          SUPABASE_SERVICE_ROLE_KEY: "stable-test-secret",
        },
      },
    });

    expect(result).toMatchObject({
      status: "degraded",
      error: "checkout_session_claim_busy",
      retryable: true,
    });
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});

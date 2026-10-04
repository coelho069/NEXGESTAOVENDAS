import { describe, expect, it } from "vitest";
import {
  ACCOUNT_INVITE_EMAIL_SUBJECT,
  buildAccountInviteEmailContent,
  buildAdminClientAccountOverview,
  canReactivateClientAccount,
  canSuspendClientAccount,
  describeClientAccountState,
  describeFinancialState,
  describePasswordProblems,
  filterAdminClientAccountRecords,
  isPasswordAcceptable,
  isResendableClientAccountStatus,
  normalizeAccountEmail,
  normalizeActivationOrigin,
  type AdminClientAccountRecord,
} from "@/lib/domain/admin-client-accounts";

const NOW = Date.parse("2026-10-05T12:00:00.000Z");
const ORG_ID = "11111111-1111-4111-8111-111111111111";

function record(overrides: Partial<AdminClientAccountRecord> = {}): AdminClientAccountRecord {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    email: "cliente@empresa.com.br",
    fullName: "Maria Souza",
    companyName: "Souza Varejo",
    organizationId: ORG_ID,
    organizationName: "Souza Varejo",
    subscriptionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    planName: "Pro",
    status: "invite_sent",
    lastError: "",
    inviteSentAt: "2026-10-05T10:00:00.000Z",
    inviteExpiresAt: "2026-10-06T10:00:00.000Z",
    activatedAt: null,
    suspendedAt: null,
    createdAt: "2026-10-05T10:00:00.000Z",
    updatedAt: "2026-10-05T10:00:00.000Z",
    subscriptionStatus: "active",
    emailConfirmed: false,
    ...overrides,
  };
}

describe("invitation state machine", () => {
  it("treats an elapsed invite window as expired even when the row still says sent", () => {
    const summary = describeClientAccountState({
      status: "invite_sent",
      subscriptionStatus: "active",
      inviteExpiresAt: "2026-10-05T11:00:00.000Z",
      now: NOW,
    });

    expect(summary.status).toBe("invite_expired");
    expect(summary.inviteExpiredByClock).toBe(true);
    expect(summary.canResend).toBe(true);
  });

  it("keeps a live invite as sent and allows resend", () => {
    const summary = describeClientAccountState({
      status: "invite_sent",
      subscriptionStatus: "active",
      inviteExpiresAt: "2026-10-06T10:00:00.000Z",
      now: NOW,
    });

    expect(summary.status).toBe("invite_sent");
    expect(summary.canResend).toBe(true);
  });

  it("never allows resend or suspension of an activated account", () => {
    const summary = describeClientAccountState({
      status: "activated",
      subscriptionStatus: "active",
      inviteExpiresAt: null,
      now: NOW,
    });

    expect(summary.canResend).toBe(false);
    expect(summary.canSuspend).toBe(true);
    expect(summary.canReactivate).toBe(false);
  });

  it("only reactivates a suspended account", () => {
    expect(canReactivateClientAccount("suspended")).toBe(true);
    expect(canReactivateClientAccount("activated")).toBe(false);
    expect(canSuspendClientAccount("suspended")).toBe(false);
    expect(isResendableClientAccountStatus("invite_failed")).toBe(true);
    expect(isResendableClientAccountStatus("activated")).toBe(false);
    expect(isResendableClientAccountStatus("suspended")).toBe(false);
  });

  it("keeps financial state independent from invitation state", () => {
    // A failed invitation on a fully paid subscription must not read as "unpaid".
    const summary = describeClientAccountState({
      status: "invite_failed",
      subscriptionStatus: "active",
      inviteExpiresAt: null,
      now: NOW,
    });

    expect(summary.status).toBe("invite_failed");
    expect(summary.financialState).toBe("active");
  });
});

describe("financial state projection", () => {
  it("maps every subscription status without inventing paid states", () => {
    expect(describeFinancialState(null)).toBe("no_subscription");
    expect(describeFinancialState("none")).toBe("no_subscription");
    expect(describeFinancialState("active")).toBe("active");
    expect(describeFinancialState("trialing")).toBe("trialing");
    expect(describeFinancialState("past_due")).toBe("past_due");
    expect(describeFinancialState("expired")).toBe("expired");
    expect(describeFinancialState("cancelled")).toBe("canceled");
    expect(describeFinancialState("canceled")).toBe("canceled");
  });
});

describe("filters", () => {
  it("searches by name, e-mail, company and organization", () => {
    const rows = [record(), record({ id: "d", email: "outro@empresa.com.br", fullName: "João Lima", companyName: "Lima Foods" })];

    expect(filterAdminClientAccountRecords(rows, { query: "maria" }, NOW)).toHaveLength(1);
    expect(filterAdminClientAccountRecords(rows, { query: "OUTRO@" }, NOW)).toHaveLength(1);
    expect(filterAdminClientAccountRecords(rows, { query: "Lima Foods" }, NOW)).toHaveLength(1);
    expect(filterAdminClientAccountRecords(rows, { query: "inexistente" }, NOW)).toHaveLength(0);
  });

  it("filters by subscription status independently of account status", () => {
    const rows = [
      record({ id: "a", status: "activated", subscriptionStatus: "active" }),
      record({ id: "b", status: "invite_failed", subscriptionStatus: "past_due" }),
    ];

    expect(filterAdminClientAccountRecords(rows, { subscriptionStatus: "past_due" }, NOW)).toHaveLength(1);
    expect(filterAdminClientAccountRecords(rows, { status: "invite_failed" }, NOW)).toHaveLength(1);
    expect(filterAdminClientAccountRecords(rows, { status: "activated" }, NOW)).toHaveLength(1);
  });

  it("applies the clock-based expiry when filtering by status", () => {
    const rows = [record({ inviteExpiresAt: "2026-10-05T11:00:00.000Z" })];
    expect(filterAdminClientAccountRecords(rows, { status: "invite_expired" }, NOW)).toHaveLength(1);
    expect(filterAdminClientAccountRecords(rows, { status: "invite_sent" }, NOW)).toHaveLength(0);
  });

  it("normalizes e-mail for comparison", () => {
    expect(normalizeAccountEmail("  Cliente@Empresa.COM ")).toBe("cliente@empresa.com");
  });
});

describe("overview", () => {
  it("aggregates each state bucket", () => {
    const rows = [
      record({ id: "a", status: "activated", activatedAt: "2026-10-05T11:00:00.000Z" }),
      record({ id: "b", status: "invite_failed" }),
      record({ id: "c", status: "suspended" }),
      record({ id: "d", status: "invite_sent", inviteExpiresAt: "2026-10-05T18:00:00.000Z" }),
    ];

    const overview = buildAdminClientAccountOverview(rows, NOW);
    expect(overview.totalAccounts).toBe(4);
    expect(overview.activatedAccounts).toBe(1);
    expect(overview.failedInvites).toBe(1);
    expect(overview.suspendedAccounts).toBe(1);
    expect(overview.pendingInvites).toBe(1);
    expect(overview.expiringInvites).toBe(1);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getPlatformAdminAccess,
  createAdminClient,
  createServerClient,
  revalidatePath,
  consumeRateLimit,
  resetRateLimitStateForTests,
} = vi.hoisted(() => ({
  getPlatformAdminAccess: vi.fn(),
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
  revalidatePath: vi.fn(),
  consumeRateLimit: vi.fn(),
  resetRateLimitStateForTests: vi.fn(),
}));

vi.mock("@/lib/auth/admin", () => ({ getPlatformAdminAccess }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createServerClient }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/security/rate-limit", () => ({
  consumeRateLimit,
  resetRateLimitStateForTests,
}));

import {
  createAdminClientAccountAction,
  resendAdminClientAccountInviteAction,
  setAdminClientAccountSuspendedAction,
} from "@/lib/server/admin-client-account-actions";

const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
const ACCOUNT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_ID = "11111111-1111-4111-8111-111111111111";

const provisioning = vi.hoisted(() => ({
  create: vi.fn(),
  resend: vi.fn(),
  suspend: vi.fn(),
}));
vi.mock("@/lib/server/admin-client-account-provisioning", () => ({
  createAdminClientAccountAction: provisioning.create,
  resendAdminClientAccountInviteAction: provisioning.resend,
  setAdminClientAccountSuspendedAction: provisioning.suspend,
  markClientAccountActivatedAction: vi.fn(),
  CLIENT_ACCOUNT_INVITE_TTL_MS: 86_400_000,
}));

beforeEach(() => {
  vi.clearAllMocks();
  getPlatformAdminAccess.mockResolvedValue(null);
  consumeRateLimit.mockReturnValue({ allowed: true, remaining: 19, retryAfterSec: 60 });
  provisioning.create.mockResolvedValue({
    ok: true,
    clientAccountId: ACCOUNT_ID,
    status: "invite_sent",
    inviteSent: true,
  });
  provisioning.resend.mockResolvedValue({
    ok: true,
    clientAccountId: ACCOUNT_ID,
    status: "invite_sent",
    inviteSent: true,
  });
  provisioning.suspend.mockResolvedValue({
    ok: true,
    clientAccountId: ACCOUNT_ID,
    status: "suspended",
    inviteSent: false,
  });
});

describe("admin action boundary", () => {
  it("rejects every invite action when there is no admin session", async () => {
    const results = await Promise.all([
      createAdminClientAccountAction({
        full_name: "Maria Souza",
        email: "maria@empresa.com.br",
        org_id: ORG_ID,
        send_invite: true,
      }),
      resendAdminClientAccountInviteAction({ client_account_id: ACCOUNT_ID }),
      setAdminClientAccountSuspendedAction({ client_account_id: ACCOUNT_ID, suspended: true }),
    ]);

    for (const result of results) {
      expect(result).toEqual({ ok: false, error: "forbidden" });
    }
    // Provisioning must never run for an unauthorized caller.
    expect(provisioning.create).not.toHaveBeenCalled();
    expect(provisioning.resend).not.toHaveBeenCalled();
    expect(provisioning.suspend).not.toHaveBeenCalled();
  });

  it("blocks a client (non platform admin) from creating accounts for others", async () => {
    // getPlatformAdminAccess resolves null for any authenticated non-admin.
    const result = await createAdminClientAccountAction({
      full_name: "Maria Souza",
      email: "maria@empresa.com.br",
      org_id: ORG_ID,
      send_invite: true,
    });
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(provisioning.create).not.toHaveBeenCalled();
  });

  it("enforces the invitation rate limit per admin", async () => {
    getPlatformAdminAccess.mockResolvedValue({ userId: ADMIN_ID, role: "platform_admin" });
    consumeRateLimit.mockReturnValue({ allowed: false, remaining: 0, retryAfterSec: 120 });

    const result = await createAdminClientAccountAction({
      full_name: "Maria Souza",
      email: "maria@empresa.com.br",
      org_id: ORG_ID,
      send_invite: true,
    });

    expect(result).toEqual({ ok: false, error: "rate_limited" });
    expect(provisioning.create).not.toHaveBeenCalled();
    expect(consumeRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: `admin-client-account-invite:${ADMIN_ID}` })
    );
  });

  it("validates the payload before invoking provisioning", async () => {
    getPlatformAdminAccess.mockResolvedValue({ userId: ADMIN_ID, role: "platform_admin" });

    const result = await createAdminClientAccountAction({ email: "not-an-email" });
    expect(result).toEqual({ ok: false, error: "validation_failed" });
    expect(provisioning.create).not.toHaveBeenCalled();
  });

  it("revalidates the admin routes after a successful write", async () => {
    getPlatformAdminAccess.mockResolvedValue({ userId: ADMIN_ID, role: "platform_admin" });

    await createAdminClientAccountAction({
      full_name: "Maria Souza",
      email: "maria@empresa.com.br",
      org_id: ORG_ID,
      send_invite: true,
    });

    expect(revalidatePath).toHaveBeenCalledWith("/admin/clientes/contas");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/assinaturas");
  });

  it("propagates typed provisioning failures without extra detail", async () => {
    getPlatformAdminAccess.mockResolvedValue({ userId: ADMIN_ID, role: "platform_admin" });
    provisioning.create.mockResolvedValue({
      ok: false,
      error: "invite_send_failed",
    } as never);

    const result = await createAdminClientAccountAction({
      full_name: "Maria Souza",
      email: "maria@empresa.com.br",
      org_id: ORG_ID,
      send_invite: true,
    });

    expect(result).toEqual({ ok: false, error: "invite_send_failed" });
  });

  it("does not rate-limit suspension changes", async () => {
    getPlatformAdminAccess.mockResolvedValue({ userId: ADMIN_ID, role: "platform_admin" });
    consumeRateLimit.mockReturnValue({ allowed: false, remaining: 0, retryAfterSec: 120 });

    const result = await setAdminClientAccountSuspendedAction({
      client_account_id: ACCOUNT_ID,
      suspended: true,
    });

    expect(result.ok).toBe(true);
    expect(provisioning.suspend).toHaveBeenCalled();
  });
});

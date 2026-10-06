import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPlatformAdminAccess: vi.fn(),
}));

vi.mock("@/lib/auth/admin", () => ({
  getPlatformAdminAccess: mocks.getPlatformAdminAccess,
}));

import { runPhase21AuditAction } from "@/lib/server/refund-phase21-audit-action";

describe("runPhase21AuditAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stops when the caller is not a platform admin", async () => {
    mocks.getPlatformAdminAccess.mockResolvedValue(null);
    const result = await runPhase21AuditAction();
    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("reads local sources and does not touch the database when the admin is allowed", async () => {
    mocks.getPlatformAdminAccess.mockResolvedValue({ userId: "44444444-4444-4444-8444-444444444444", role: "platform_admin" });
    const result = await runPhase21AuditAction();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passed).toBe(true);
    expect(result.checks.map((check) => check.id)).toContain("audit_action_has_no_side_effects");
  });
});

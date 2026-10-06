import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPlatformAdminAccess: vi.fn(),
  createAdminClient: vi.fn(),
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

import { reviewRefundRequestAction } from "@/lib/server/admin-refund-request-actions";

describe("reviewRefundRequestAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stops before the database when the caller is not a platform admin", async () => {
    mocks.getPlatformAdminAccess.mockResolvedValue(null);
    const result = await reviewRefundRequestAction({
      id: "22222222-2222-4222-8222-222222222222",
      action: "approve",
    });
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});

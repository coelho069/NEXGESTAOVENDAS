import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient }));

import { getPlatformAdminAccess } from "@/lib/auth/admin";

describe("platform admin authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when there is no authenticated user", async () => {
    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null } })),
      },
      from: vi.fn(),
    });

    await expect(getPlatformAdminAccess()).resolves.toBeNull();
  });

  it("blocks a common authenticated user without platform_admins row", async () => {
    const from = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          })),
        })),
      })),
    }));

    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } },
        })),
      },
      from,
    });

    await expect(getPlatformAdminAccess()).resolves.toBeNull();
    expect(from).toHaveBeenCalledWith("platform_admins");
  });

  it("allows an active platform admin", async () => {
    const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: userId } } })),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: { user_id: userId },
                error: null,
              })),
            })),
          })),
        })),
      })),
    });

    await expect(getPlatformAdminAccess()).resolves.toEqual({
      userId,
      role: "platform_admin",
    });
  });

  it("fails closed when the platform_admins query errors", async () => {
    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } },
        })),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: null,
                error: { message: "relation does not exist" },
              })),
            })),
          })),
        })),
      })),
    });

    await expect(getPlatformAdminAccess()).resolves.toBeNull();
  });
});

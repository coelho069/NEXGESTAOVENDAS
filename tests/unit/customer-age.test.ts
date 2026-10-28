import { beforeEach, describe, expect, it, vi } from "vitest";
import { customerWriteSchema, customerPatchSchema } from "@/lib/validation/schemas";
import type { AuthedContext } from "@/lib/auth/session";

// --- Zod schema tests ---

describe("customerWriteSchema age validation", () => {
  it("accepts age 0", () => {
    const result = customerWriteSchema.safeParse({ name: "Test", age: 0 });
    expect(result.success).toBe(true);
    expect(result.data?.age).toBe(0);
  });

  it("accepts age 120", () => {
    const result = customerWriteSchema.safeParse({ name: "Test", age: 120 });
    expect(result.success).toBe(true);
    expect(result.data?.age).toBe(120);
  });

  it("rejects age -1", () => {
    const result = customerWriteSchema.safeParse({ name: "Test", age: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects age 121", () => {
    const result = customerWriteSchema.safeParse({ name: "Test", age: 121 });
    expect(result.success).toBe(false);
  });

  it("rejects fractional age 12.5", () => {
    const result = customerWriteSchema.safeParse({ name: "Test", age: 12.5 });
    expect(result.success).toBe(false);
  });

  it("converts empty string to null", () => {
    const result = customerWriteSchema.safeParse({ name: "Test", age: "" });
    expect(result.success).toBe(true);
    expect(result.data?.age).toBeNull();
  });

  it("converts omitted age to null", () => {
    const result = customerWriteSchema.safeParse({ name: "Test" });
    expect(result.success).toBe(true);
    expect(result.data?.age).toBeNull();
  });
});

// --- Route 401 test ---

const { getAuthedContext } = vi.hoisted(() => ({
  getAuthedContext: vi.fn<() => Promise<AuthedContext | null>>(),
}));

vi.mock("@/lib/auth/session", () => ({ getAuthedContext }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }),
  }),
}));

import { POST } from "@/app/api/customers/route";

describe("POST /api/customers auth", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    getAuthedContext.mockResolvedValue(null);
    const res = await POST(
      new Request("http://localhost/api/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Ana" }),
      })
    );
    expect(res.status).toBe(401);
  });
});

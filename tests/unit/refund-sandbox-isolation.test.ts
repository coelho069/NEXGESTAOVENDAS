import { describe, expect, it, vi } from "vitest";
import { refundSandboxProcessingEnabled } from "@/lib/domain/refund-sandbox-mode";
import { processAdminSandboxRefund } from "@/lib/server/admin-sandbox-refund-processing";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

const LOCAL = {
  NODE_ENV: "test",
  REFUND_SANDBOX_PROCESSING: "local",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_URL: "http://127.0.0.1:54321",
  DATABASE_URL: "postgresql://postgres@127.0.0.1:54322/postgres",
};

describe("refund sandbox database isolation", () => {
  it.each([
    ["http://127.0.0.1:54321", true],
    ["http://localhost:54321", true],
    ["http://[::1]:54321", true],
    ["https://remote.example.supabase.co", false],
    ["https://example.com", false],
    ["http://8.8.8.8:54321", false],
    ["http://203.0.113.10", false],
    ["http://192.168.0.10:54321", false],
    ["not-a-url", false],
    ["", false],
  ])("endpoint %s local=%s", (url, allowed) => {
    expect(
      refundSandboxProcessingEnabled({
        ...LOCAL,
        NEXT_PUBLIC_SUPABASE_URL: url,
      })
    ).toBe(allowed);
  });

  it("blocks a missing endpoint", () => {
    const { NEXT_PUBLIC_SUPABASE_URL: _ignored, ...missing } = LOCAL;
    expect(refundSandboxProcessingEnabled(missing)).toBe(false);
  });

  it("blocks production even when the endpoint is loopback and the flag is local", () => {
    expect(refundSandboxProcessingEnabled({ ...LOCAL, NODE_ENV: "production" })).toBe(false);
  });

  it("blocks a missing sandbox flag even when the endpoint is loopback", () => {
    const { REFUND_SANDBOX_PROCESSING: _ignored, ...missing } = LOCAL;
    expect(refundSandboxProcessingEnabled(missing)).toBe(false);
  });

  it("blocks when a second database variable points at a public host", () => {
    expect(
      refundSandboxProcessingEnabled({
        ...LOCAL,
        DATABASE_URL: "postgresql://postgres@203.0.113.10:5432/postgres",
      })
    ).toBe(false);
  });

  it("production_database_containment refuses complete_sandbox_refund before any connection", async () => {
    const rpc = vi.fn(async () => {
      throw new Error("remote_write");
    });
    const from = vi.fn(() => {
      throw new Error("remote_read");
    });
    const admin = { from, rpc } as unknown as SupabaseClient<Database>;
    const outcome = await processAdminSandboxRefund({
      admin,
      refundRequestId: "11111111-1111-4111-8111-111111111111",
      scenario: "success",
      env: {
        NODE_ENV: "development",
        REFUND_SANDBOX_PROCESSING: "local",
        NEXT_PUBLIC_SUPABASE_URL: "https://remote.example.supabase.co",
        SUPABASE_URL: "https://remote.example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "remote-service-role-must-not-connect",
      },
    });
    expect(outcome.httpStatus).toBe(403);
    expect(outcome.body).toMatchObject({ error: "sandbox_disabled", financial_effect: false });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

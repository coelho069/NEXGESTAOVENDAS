import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { describeActivationPasswordError } from "@/lib/domain/activation-link";
import { defineClientActivationPassword } from "@/lib/server/admin-client-account-provisioning";

function adminFor(status: string) {
  const updateUserById = vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null }));
  const from = vi.fn((table: string) => {
    if (table === "client_accounts") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: "account-1", status }, error: null }),
          }),
        }),
        update: () => ({
          eq: async () => ({ error: null }),
        }),
      };
    }
    return { insert: async () => ({ error: null }) };
  });
  return {
    admin: { from, auth: { admin: { updateUserById } } } as unknown as SupabaseClient<Database>,
    updateUserById,
  };
}

describe("defineClientActivationPassword", () => {
  it("grava a senha no servidor para a conta do link", async () => {
    const { admin, updateUserById } = adminFor("invite_sent");
    const result = await defineClientActivationPassword("SenhaForte1", {
      admin,
      user: { id: "user-1" },
      freshAccessLink: true,
    });
    expect(result).toEqual({ ok: true });
    expect(updateUserById).toHaveBeenCalledWith("user-1", {
      password: "SenhaForte1",
      email_confirm: true,
    });
  });

  it("recusa conta suspensa sem chamar o Auth", async () => {
    const { admin, updateUserById } = adminFor("suspended");
    const result = await defineClientActivationPassword("SenhaForte1", {
      admin,
      user: { id: "user-1" },
      freshAccessLink: true,
    });
    expect(result.ok).toBe(false);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("traduz senha fraca rejeitada pelo provedor", async () => {
    const { admin } = adminFor("invite_sent");
    const result = await defineClientActivationPassword("SenhaForte1", {
      admin,
      user: { id: "user-1" },
      freshAccessLink: true,
      updatePassword: async () => ({ errorMessage: "Password is known to be weak and easy to guess" }),
    });
    expect(result).toEqual({
      ok: false,
      error: "Essa senha é fácil de adivinhar. Escolha outra.",
    });
  });
});

describe("describeActivationPasswordError", () => {
  it("não repete a mensagem crua de sessão ausente", () => {
    expect(describeActivationPasswordError("Auth session missing!")).toMatch(/link expirou/);
  });
});

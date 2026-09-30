import { beforeEach, describe, expect, it, vi } from "vitest";
import { FunctionsHttpError } from "@supabase/supabase-js";
import {
  ANNE_GENERIC_ERROR,
  isAnneSupportRoute,
  readStoredConversaId,
  sendAnneChatMessage,
  writeStoredConversaId,
} from "@/lib/support/anne-chat";

describe("isAnneSupportRoute", () => {
  it("matches authenticated app routes", () => {
    expect(isAnneSupportRoute("/pdv")).toBe(true);
    expect(isAnneSupportRoute("/pdv?store=abc")).toBe(false);
    expect(isAnneSupportRoute("/inventory")).toBe(true);
    expect(isAnneSupportRoute("/dashboard")).toBe(true);
  });

  it("rejects public routes", () => {
    expect(isAnneSupportRoute("/")).toBe(false);
    expect(isAnneSupportRoute("/login")).toBe(false);
    expect(isAnneSupportRoute("/auth/callback")).toBe(false);
  });
});

describe("conversa session storage", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("persists conversa id per user", () => {
    writeStoredConversaId("user-1", "conversa-123");
    expect(readStoredConversaId("user-1")).toBe("conversa-123");
    expect(readStoredConversaId("user-2")).toBeNull();
  });
});

describe("sendAnneChatMessage", () => {
  it("returns success payload from invoke", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: {
        reply: "Olá!",
        conversa_id: "abc",
        encaminhado: false,
      },
      error: null,
    });

    const result = await sendAnneChatMessage(
      { message: "Preciso de ajuda" },
      { functions: { invoke } } as never
    );

    expect(invoke).toHaveBeenCalledWith("anne-chat", {
      body: { message: "Preciso de ajuda" },
    });
    expect(result).toEqual({
      ok: true,
      data: { reply: "Olá!", conversa_id: "abc", encaminhado: false },
    });
  });

  it("returns reply from 429 responses", async () => {
    const response = new Response(
      JSON.stringify({ reply: "Muitas mensagens. Aguarde um pouco." }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(response),
    });

    const result = await sendAnneChatMessage(
      { message: "teste", conversa_id: "conv-1" },
      { functions: { invoke } } as never
    );

    expect(result).toEqual({
      ok: true,
      data: {
        reply: "Muitas mensagens. Aguarde um pouco.",
        conversa_id: "conv-1",
        encaminhado: false,
      },
    });
  });

  it("returns unauthorized for 401 responses", async () => {
    const response = new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(response),
    });

    const result = await sendAnneChatMessage({ message: "teste" }, { functions: { invoke } } as never);

    expect(result).toEqual({ ok: false, unauthorized: true });
  });

  it("returns generic error for unexpected failures", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: new Error("network"),
    });

    const result = await sendAnneChatMessage({ message: "teste" }, { functions: { invoke } } as never);

    expect(result).toEqual({ ok: false, unauthorized: false, message: ANNE_GENERIC_ERROR });
  });
});

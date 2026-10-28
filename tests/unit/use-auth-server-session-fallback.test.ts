import { act, renderHook, waitFor } from "@testing-library/react";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/hooks/use-auth";
import { useSessionStore } from "@/stores/session-store";

type AuthListener = (event: AuthChangeEvent, session: Session | null) => void;

const authState: { listener: AuthListener | null } = { listener: null };

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (listener: AuthListener) => {
        authState.listener = listener;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  }),
}));

vi.mock("@/lib/offline/end-session", () => ({
  clearClientSessionStorage: vi.fn(async () => undefined),
}));

function realSession(id: string, email: string): Session {
  return { user: { id, email } as unknown as User } as unknown as Session;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emit(event: AuthChangeEvent, session: Session | null) {
  act(() => {
    authState.listener?.(event, session);
  });
}

describe("useAuth server session fallback", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    authState.listener = null;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    useSessionStore.setState({ userId: null, email: null, sessionEnded: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the server session when the client has none (200)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { authenticated: true, user: { id: "user-server", email: "ana@x.com" } })
    );

    const { result } = renderHook(() => useAuth());
    emit("INITIAL_SESSION", null);

    await waitFor(() => expect(useSessionStore.getState().userId).toBe("user-server"));
    expect(useSessionStore.getState().email).toBe("ana@x.com");
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it("keeps userId null when the server returns 401", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { authenticated: false }));

    const { result } = renderHook(() => useAuth());
    emit("INITIAL_SESSION", null);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(useSessionStore.getState().userId).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("does not overwrite a real client session with the server result", async () => {
    let resolveServer: (response: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (resolveServer = resolve))
    );

    renderHook(() => useAuth());
    emit("INITIAL_SESSION", null);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    emit("SIGNED_IN", realSession("user-client", "bia@x.com"));
    expect(useSessionStore.getState().userId).toBe("user-client");

    await act(async () => {
      resolveServer(jsonResponse(401, { authenticated: false }));
      await Promise.resolve();
    });
    expect(useSessionStore.getState().userId).toBe("user-client");
  });

  it("ignores a stale 200 from the server after a newer auth event", async () => {
    let resolveServer: (response: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (resolveServer = resolve))
    );

    renderHook(() => useAuth());
    emit("INITIAL_SESSION", null);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    emit("SIGNED_IN", realSession("user-client", "bia@x.com"));

    await act(async () => {
      resolveServer(
        jsonResponse(200, { authenticated: true, user: { id: "user-stale", email: null } })
      );
      await Promise.resolve();
    });
    expect(useSessionStore.getState().userId).toBe("user-client");
  });

  it("does not restore the server session after an explicit sign-out", async () => {
    renderHook(() => useAuth());
    emit("SIGNED_OUT", null);

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useSessionStore.getState().userId).toBeNull();
  });

  it("does not break when the server request rejects", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const { result } = renderHook(() => useAuth());
    emit("INITIAL_SESSION", null);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(useSessionStore.getState().userId).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});

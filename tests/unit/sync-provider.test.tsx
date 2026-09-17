import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { useAuthMock, startHeartbeatMock, flushPendingMock, refreshSyncUiMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  startHeartbeatMock: vi.fn(() => () => undefined),
  flushPendingMock: vi.fn(),
  refreshSyncUiMock: vi.fn(),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/hooks/use-checkout", () => ({
  useCheckout: () => ({
    flushPending: flushPendingMock,
    refreshSyncUi: refreshSyncUiMock,
  }),
}));

vi.mock("@/lib/offline/heartbeat", () => ({
  startHeartbeat: () => startHeartbeatMock(),
}));

vi.mock("@/lib/offline/session-pdv-db", () => ({
  getSessionPdvLocalDb: () => ({
    meta: { put: vi.fn() },
  }),
}));

vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: { userId: string | null }) => unknown) =>
    selector({ userId: "user-1" }),
}));

vi.mock("@/stores/cart-store", () => ({
  useCartStore: (selector: (state: { storeId: string | null }) => unknown) =>
    selector({ storeId: "22222222-2222-4222-8222-222222222201" }),
}));

import { SyncProvider } from "@/components/providers/sync-provider";

describe("SyncProvider", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders children while auth is still loading", () => {
    useAuthMock.mockReturnValue({ user: null, loading: true });

    render(
      <SyncProvider>
        <h1>Entrar no PDV</h1>
      </SyncProvider>
    );

    expect(screen.getByRole("heading", { name: "Entrar no PDV" })).toBeVisible();
    expect(startHeartbeatMock).not.toHaveBeenCalled();
    expect(refreshSyncUiMock).not.toHaveBeenCalled();
  });

  it("starts heartbeat and sync after auth loading completes", () => {
    useAuthMock.mockReturnValue({ user: { id: "user-1" }, loading: false });

    render(
      <SyncProvider>
        <p>PDV</p>
      </SyncProvider>
    );

    expect(screen.getByText("PDV")).toBeVisible();
    expect(startHeartbeatMock).toHaveBeenCalledTimes(1);
    expect(refreshSyncUiMock).toHaveBeenCalledTimes(1);
    expect(flushPendingMock).toHaveBeenCalledTimes(1);
  });

  it("never blanks the tree with an auth-loading return null", () => {
    const src = readFileSync(
      path.resolve(process.cwd(), "src/components/providers/sync-provider.tsx"),
      "utf8"
    );
    expect(src).not.toMatch(/if\s*\(\s*loading\s*\)\s*return\s+null/);
  });
});

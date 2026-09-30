import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AnneSupportWidget } from "@/components/support/anne-support-widget";
import { OpenAnneSupportButton } from "@/components/support/open-anne-support-button";
import {
  ANNE_SUPPORT_OPEN_EVENT,
  openAnneSupport,
} from "@/lib/support/open-anne-support";

const mockUseAuth = vi.fn();
const mockUsePathname = vi.fn();
const mockPush = vi.fn();

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/hooks/use-anne-chat", () => ({
  useAnneChat: () => ({
    messages: [{ id: "greeting", role: "assistant", content: "Oi!" }],
    input: "",
    setInput: vi.fn(),
    sending: false,
    canSend: false,
    sendMessage: vi.fn(),
    initialized: true,
  }),
}));

describe("openAnneSupport", () => {
  it("dispatches the Anne support open event", () => {
    const listener = vi.fn();
    window.addEventListener(ANNE_SUPPORT_OPEN_EVENT, listener);

    openAnneSupport();

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(ANNE_SUPPORT_OPEN_EVENT, listener);
  });
});

describe("AnneSupportWidget open event", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("opens the chat panel when the open event is dispatched", async () => {
    mockUseAuth.mockReturnValue({ user: { id: "user-1" }, loading: false });
    mockUsePathname.mockReturnValue("/pdv");

    render(<AnneSupportWidget />);
    expect(screen.queryByTestId("anne-support-panel")).toBeNull();

    await waitFor(() => {
      openAnneSupport();
      expect(screen.getByTestId("anne-support-panel")).toBeInTheDocument();
    });
  });

  it("does not render on public routes", () => {
    mockUseAuth.mockReturnValue({ user: { id: "user-1" }, loading: false });
    mockUsePathname.mockReturnValue("/");

    render(<AnneSupportWidget />);
    expect(screen.queryByTestId("anne-support-widget")).toBeNull();
  });
});

describe("OpenAnneSupportButton", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("opens Anne chat for authenticated users", () => {
    mockUseAuth.mockReturnValue({ user: { id: "user-1" }, loading: false });
    const listener = vi.fn();
    window.addEventListener(ANNE_SUPPORT_OPEN_EVENT, listener);

    render(<OpenAnneSupportButton label="Abrir chat de suporte" />);
    fireEvent.click(screen.getByRole("button", { name: /Abrir chat de suporte/i }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
    window.removeEventListener(ANNE_SUPPORT_OPEN_EVENT, listener);
  });

  it("redirects unauthenticated users to login", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });

    render(<OpenAnneSupportButton />);
    fireEvent.click(screen.getByRole("button", { name: /Falar com o suporte/i }));

    expect(mockPush).toHaveBeenCalledWith("/login");
  });
});

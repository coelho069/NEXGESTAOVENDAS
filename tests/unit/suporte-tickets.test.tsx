import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import TicketsPage from "@/app/suporte/tickets/page";

describe("TicketsPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not expose WhatsApp links or support CTAs", () => {
    render(<TicketsPage />);

    expect(screen.queryByRole("link", { name: /WhatsApp/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /WhatsApp/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /Abrir chat/i })).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/wa\.me/i);
  });

  it("points users to the floating Suporte button", () => {
    render(<TicketsPage />);

    expect(screen.getByText(/use o botão/i)).toHaveTextContent("Suporte");
    expect(screen.getByText(/Anne, assistente virtual/i)).toBeInTheDocument();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  buildPdvHotkeyHints,
  getPdvShortcutKeyLabel,
  matchPdvShortcut,
} from "@/lib/domain/pdv-shortcuts";
import { DiscountDialog } from "@/components/pdv/discount-dialog";
import { PdvHotkeysBar } from "@/components/pdv/pdv-hotkeys-bar";
import { SuporteOperacional } from "@/components/support/suporte-operacional";
import { getSupportWhatsAppUrl, SUPPORT_WHATSAPP_ENV } from "@/lib/support/whatsapp";

vi.mock("@/hooks/use-card-payment-health", () => ({
  useCardPaymentHealth: vi.fn(() => false),
}));

import { useCardPaymentHealth } from "@/hooks/use-card-payment-health";

const mockedCardHealth = vi.mocked(useCardPaymentHealth);

describe("buildPdvHotkeyHints", () => {
  it("matches real PDV shortcut keys from matchPdvShortcut", () => {
    const hints = buildPdvHotkeyHints({ card: false });
    const mapped = hints.filter(
      (hint): hint is typeof hint & { shortcut: Exclude<typeof hint.shortcut, "enterFirstResult"> } =>
        hint.shortcut !== "enterFirstResult"
    );

    for (const hint of mapped) {
      const key =
        hint.keys === "+/−"
          ? "+"
          : hint.keys === "Del"
            ? "Delete"
            : hint.keys === "Esc"
              ? "Escape"
              : hint.keys;
      const ctrl = hint.keys.startsWith("Ctrl+");
      const event = {
        key: ctrl ? hint.keys.slice(5) : key,
        ctrlKey: ctrl,
        metaKey: false,
        altKey: false,
      };
      expect(matchPdvShortcut(event)).toBe(hint.shortcut);
    }
  });

  it("omits card (F9) when card flag is off", () => {
    const hints = buildPdvHotkeyHints({ card: false });
    expect(hints.some((hint) => hint.keys === "F9")).toBe(false);
    expect(hints.some((hint) => hint.keys === "F10")).toBe(true);
  });

  it("includes card (F9) when card flag is on", () => {
    const hints = buildPdvHotkeyHints({ card: true });
    expect(hints.some((hint) => hint.keys === "F9" && hint.label === "Cartão")).toBe(true);
  });
});

describe("DiscountDialog shortcut label", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows F4 from the PDV shortcut source", () => {
    render(
      <DiscountDialog
        open={true}
        value="0.00"
        max="10.00"
        role="cashier"
        error={null}
        onChange={() => undefined}
        onApply={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(getPdvShortcutKeyLabel("discount")).toBe("F4");
    expect(screen.getByRole("heading", { name: "Desconto (F4)" })).toBeInTheDocument();
  });
});

describe("PdvHotkeysBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("hides F9 when card is not selectable", () => {
    render(<PdvHotkeysBar cardSelectable={false} />);
    expect(screen.getByTestId("pdv-hotkeys-bar")).not.toHaveTextContent("F9");
    expect(screen.getByTestId("pdv-hotkeys-bar")).toHaveTextContent("F4");
    expect(screen.getByTestId("pdv-hotkeys-bar")).toHaveTextContent("F10");
  });
});

describe("getSupportWhatsAppUrl", () => {
  const original = process.env[SUPPORT_WHATSAPP_ENV];

  afterEach(() => {
    if (original === undefined) {
      delete process.env[SUPPORT_WHATSAPP_ENV];
    } else {
      process.env[SUPPORT_WHATSAPP_ENV] = original;
    }
  });

  it("returns null when env is unset", () => {
    delete process.env[SUPPORT_WHATSAPP_ENV];
    expect(getSupportWhatsAppUrl()).toBeNull();
  });

  it("returns null for invalid URLs", () => {
    process.env[SUPPORT_WHATSAPP_ENV] = "http://wa.me/5511999999999";
    expect(getSupportWhatsAppUrl()).toBeNull();
  });

  it("returns the configured WhatsApp URL", () => {
    process.env[SUPPORT_WHATSAPP_ENV] =
      "https://wa.me/5511888888888?text=Suporte%20NEX";
    expect(getSupportWhatsAppUrl()).toBe(
      "https://wa.me/5511888888888?text=Suporte%20NEX"
    );
  });
});

describe("SuporteOperacional WhatsApp CTA", () => {
  const original = process.env[SUPPORT_WHATSAPP_ENV];

  afterEach(() => {
    cleanup();
    mockedCardHealth.mockReturnValue(false);
    if (original === undefined) {
      delete process.env[SUPPORT_WHATSAPP_ENV];
    } else {
      process.env[SUPPORT_WHATSAPP_ENV] = original;
    }
  });

  it("hides WhatsApp CTA when env is unset", () => {
    delete process.env[SUPPORT_WHATSAPP_ENV];

    render(<SuporteOperacional />);
    fireEvent.click(screen.getByRole("button", { name: /Suporte Operacional/i }));

    expect(screen.queryByTestId("support-whatsapp-cta")).toBeNull();
  });

  it("shows WhatsApp CTA when env is configured", () => {
    process.env[SUPPORT_WHATSAPP_ENV] = "https://wa.me/5511888888888";

    render(<SuporteOperacional />);
    fireEvent.click(screen.getByRole("button", { name: /Suporte Operacional/i }));

    expect(screen.getByTestId("support-whatsapp-cta")).toHaveAttribute(
      "href",
      "https://wa.me/5511888888888"
    );
  });

  it("lists PDV shortcuts without F9 when card is unavailable", () => {
    delete process.env[SUPPORT_WHATSAPP_ENV];
    mockedCardHealth.mockReturnValue(false);

    render(<SuporteOperacional />);
    fireEvent.click(screen.getByRole("button", { name: /Suporte Operacional/i }));

    const hints = screen.getByTestId("support-hotkey-hints");
    expect(hints).toHaveTextContent("F4");
    expect(hints).not.toHaveTextContent("F9");
  });
});

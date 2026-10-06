import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentApprovedScreen } from "@/components/marketing/payment-approved-screen";
import { PaymentConfirmationScreen } from "@/components/marketing/payment-confirmation-screen";

afterEach(() => {
  cleanup();
});

describe("PaymentApprovedScreen", () => {
  it("mostra pagamento aprovado, plano, valor e o login do PDV", () => {
    render(
      <PaymentApprovedScreen
        planName="Profissional"
        amountLabel="R$ 149,90"
        maskedEmail="jo****@loja.com"
        accessEmailSent
        loginHref="/login"
      />
    );

    expect(screen.getByRole("heading", { name: "Pagamento aprovado" })).toBeTruthy();
    expect(screen.getByText("Assinatura ativa")).toBeTruthy();
    expect(screen.getByText("Profissional")).toBeTruthy();
    expect(screen.getByText("R$ 149,90")).toBeTruthy();
    expect(screen.getByText("Aprovado")).toBeTruthy();
    expect(screen.getByText(/jo\*\*\*\*@loja.com/)).toBeTruthy();

    const login = screen.getByRole("link", { name: "Ir para o login do PDV" });
    expect(login.getAttribute("href")).toBe("/login");
  });

  it("avisa que o e-mail de acesso ainda será enviado", () => {
    render(
      <PaymentApprovedScreen
        planName={null}
        amountLabel={null}
        maskedEmail={null}
        accessEmailSent={false}
        loginHref="/login"
      />
    );

    expect(screen.getByText(/O e-mail de acesso chega em instantes/)).toBeTruthy();
    expect(screen.getByText("seu e-mail")).toBeTruthy();
  });
});

describe("PaymentConfirmationScreen sucesso", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mostra pagamento aprovado na rota de sucesso sem esperar a API", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    render(<PaymentConfirmationScreen variant="sucesso" query={{}} loginHref="/login" />);
    expect(screen.getByRole("heading", { name: "Pagamento aprovado" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Estamos confirmando…" })).toBeNull();
  });
});

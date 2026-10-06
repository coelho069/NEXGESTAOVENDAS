import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  PLACEHOLDER_CNPJ,
  PLACEHOLDER_LEGAL_NAME,
  PLACEHOLDER_SUPPORT_EMAIL,
  REFUND_POLICY_CANONICAL_URL,
  REFUND_POLICY_PATH,
  REFUND_POLICY_REDIRECT_SOURCES,
  getPublicCompanyProfile,
  isUsablePublicEmail,
  stripeCheckoutRefundPolicyNotice,
} from "@/lib/domain/refund-policy";
import { RefundPolicyPage } from "@/components/marketing/refund-policy-page";
import { PlansSalesPage } from "@/components/marketing/plans-sales-page";
import { SubscribePlanButton } from "@/components/marketing/subscribe-plan-button";

afterEach(() => {
  cleanup();
});

describe("refund policy domain", () => {
  it("keeps the Stripe Dashboard canonical URL stable", () => {
    expect(REFUND_POLICY_PATH).toBe("/politica-de-reembolso");
    expect(REFUND_POLICY_CANONICAL_URL).toBe(
      "https://nexgestaovendas.com.br/politica-de-reembolso"
    );
    expect(REFUND_POLICY_REDIRECT_SOURCES).toEqual(["/politica-de-reembolsos", "/reembolso"]);
  });

  it("never invents CNPJ or razão social", () => {
    const profile = getPublicCompanyProfile({});
    expect(profile.legalName).toBe(PLACEHOLDER_LEGAL_NAME);
    expect(profile.cnpj).toBe(PLACEHOLDER_CNPJ);
    expect(profile.supportEmail).toBe(PLACEHOLDER_SUPPORT_EMAIL);
    expect(profile.hasRegisteredLegalName).toBe(false);
    expect(profile.hasRegisteredCnpj).toBe(false);
    expect(profile.hasRegisteredSupportEmail).toBe(false);
    expect(profile.cnpj).not.toMatch(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
  });

  it("uses public env when the operator fills company identity", () => {
    const profile = getPublicCompanyProfile({
      NEXT_PUBLIC_COMPANY_LEGAL_NAME: "Empresa Exemplo LTDA",
      NEXT_PUBLIC_COMPANY_CNPJ: "00.000.000/0001-00",
      NEXT_PUBLIC_COMPANY_UF: "SP",
      NEXT_PUBLIC_SUPPORT_EMAIL: "suporte@nexgestaovendas.com.br",
    });
    expect(profile.legalName).toBe("Empresa Exemplo LTDA");
    expect(profile.cnpj).toBe("00.000.000/0001-00");
    expect(profile.jurisdiction).toBe("SP");
    expect(profile.supportEmail).toBe("suporte@nexgestaovendas.com.br");
    expect(profile.hasRegisteredLegalName).toBe(true);
    expect(profile.hasRegisteredCnpj).toBe(true);
    expect(profile.hasRegisteredSupportEmail).toBe(true);
  });

  it("builds the Stripe Checkout notice with the canonical URL", () => {
    expect(isUsablePublicEmail("nao-e-email")).toBe(false);
    expect(stripeCheckoutRefundPolicyNotice()).toContain(REFUND_POLICY_CANONICAL_URL);
  });
});

describe("refund policy page", () => {
  it("renders the required sections with editable window copy", () => {
    render(
      <RefundPolicyPage
        company={getPublicCompanyProfile({})}
        refundWindowDays={7}
        yearlyPlanRefundWindowDays={7}
        reviewBusinessDays={5}
        effectiveDateIso="2026-09-27"
      />
    );

    expect(
      screen.getByRole("heading", {
        name: "Política de Reembolsos e Devoluções — Nex Gestão Vendas",
      })
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Quem somos e o que é cobrado/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Prazo para solicitar reembolso/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Como solicitar/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Análise e estorno/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Quando não há reembolso/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Cancelamento vs reembolso/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Pagamentos via PIX/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Contato e foro/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Vigência/ })).toBeInTheDocument();
    expect(screen.getByText(PLACEHOLDER_LEGAL_NAME)).toBeInTheDocument();
    expect(screen.getByText(PLACEHOLDER_CNPJ)).toBeInTheDocument();
    expect(screen.getAllByText(/7 dias corridos/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/27 de setembro de 2026/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/software de gestão de vendas/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Mercado Pago/).length).toBeGreaterThan(0);
    expect(screen.getByText(/pelo botão Solicitar reembolso/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/ID do pagamento no Mercado Pago/)).not.toBeInTheDocument();
    expect(screen.queryByText(/processada pelo Stripe/)).not.toBeInTheDocument();
    expect(screen.queryByText(/in_/)).not.toBeInTheDocument();
  });

  it("declares canonical metadata and editable constants on the route file", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/politica-de-reembolso/page.tsx"),
      "utf8"
    );
    const domain = readFileSync(join(process.cwd(), "src/lib/domain/refund-policy.ts"), "utf8");
    expect(domain).toContain("export const REFUND_WINDOW_DAYS = 7");
    expect(domain).toContain("export const YEARLY_PLAN_REFUND_WINDOW_DAYS = 7");
    expect(domain).toContain('export const POLICY_EFFECTIVE_DATE_ISO = "2026-10-06"');
    expect(source).toContain("REFUND_WINDOW_DAYS");
    expect(source).toContain("YEARLY_PLAN_REFUND_WINDOW_DAYS");
    expect(source).toContain('canonical: REFUND_POLICY_CANONICAL_URL');
    expect(source).toContain("Política de Reembolsos e Devoluções — Nex Gestão Vendas");
  });

  it("configures 301 aliases to the canonical path", () => {
    const source = readFileSync(join(process.cwd(), "next.config.mjs"), "utf8");
    expect(source).toContain('source: "/politica-de-reembolsos"');
    expect(source).toContain('source: "/reembolso"');
    expect(source).toContain('destination: "/politica-de-reembolso"');
    expect(source).toContain("statusCode: 301");
  });
});

describe("refund policy links on sales and checkout", () => {
  it("exposes the policy in the public footer", () => {
    render(
      <PlansSalesPage
        plans={[]}
        loadError={null}
        isAuthenticated={false}
        checkoutEnabled={false}
      />
    );
    const footer = screen.getByRole("contentinfo");
    expect(
      screen.getAllByRole("link", { name: "Política de reembolso" }).some((link) => {
        return link.getAttribute("href") === REFUND_POLICY_PATH && footer.contains(link);
      })
    ).toBe(true);
  });

  it("links the policy from the checkout modal", () => {
    render(
      <SubscribePlanButton
        planId="11111111-1111-4111-8111-111111111111"
        planLabel="Essencial"
        stripeEnabled={true}
        subscriptionEnabled={true}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Assinar" }));
    const policyLink = screen.getByRole("link", {
      name: "Política de Reembolsos e Devoluções",
    });
    expect(policyLink).toHaveAttribute("href", REFUND_POLICY_PATH);
  });
});

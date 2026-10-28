import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  PRIVACY_POLICY_CANONICAL_URL,
  PRIVACY_POLICY_PATH,
  PRIVACY_POLICY_REDIRECT_SOURCES,
  privacyPolicyCheckoutNotice,
} from "@/lib/domain/privacy-policy";
import {
  ANONYMIZED_CUSTOMER_NAME,
  buildAnonymizedCustomerPatch,
  isAnonymizedCustomerName,
} from "@/lib/domain/customer-lgpd";
import { PrivacyPolicyPage } from "@/components/marketing/privacy-policy-page";
import { getPublicCompanyProfile } from "@/lib/domain/refund-policy";

afterEach(() => {
  cleanup();
});

describe("privacy policy domain", () => {
  it("keeps the canonical privacy URL stable", () => {
    expect(PRIVACY_POLICY_PATH).toBe("/politica-de-privacidade");
    expect(PRIVACY_POLICY_CANONICAL_URL).toBe(
      "https://nexgestaovendas.com.br/politica-de-privacidade"
    );
    expect(PRIVACY_POLICY_REDIRECT_SOURCES).toEqual(["/privacidade", "/lgpd", "/privacy"]);
    expect(privacyPolicyCheckoutNotice()).toContain(PRIVACY_POLICY_CANONICAL_URL);
  });
});

describe("customer lgpd helpers", () => {
  it("builds an anonymized patch without inventing personal data", () => {
    expect(buildAnonymizedCustomerPatch()).toEqual({
      name: ANONYMIZED_CUSTOMER_NAME,
      document: null,
      email: null,
    });
    expect(isAnonymizedCustomerName(ANONYMIZED_CUSTOMER_NAME)).toBe(true);
    expect(isAnonymizedCustomerName("Maria")).toBe(false);
  });
});

describe("privacy policy page", () => {
  it("states it is not a legal certification and lists DSAR paths", () => {
    render(
      <PrivacyPolicyPage
        company={getPublicCompanyProfile({})}
        effectiveDateIso="2026-10-15"
      />
    );

    expect(
      screen.getByRole("heading", {
        name: /Aviso de Privacidade — Nex Gestão Vendas/i,
      })
    ).toBeTruthy();
    expect(screen.getByText(/Não é certificação jurídica/i)).toBeTruthy();
    expect(screen.getByText(/Não usamos, neste/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Política de Reembolsos/i })).toBeTruthy();
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GENERATED_PASSWORD_MIN_LENGTH,
  buildAccessEmailContent,
  buildCheckoutSessionExternalReference,
  buildOrganizationDisplayName,
  buildOrganizationSlug,
  generateTemporaryPassword,
  parseCheckoutSessionExternalReference,
} from "@/lib/domain/onboarding-visitor";
import {
  parseAssinaturasExternalReference,
} from "@/lib/domain/mercadopago-assinaturas";
import { getEmailSenderConfig } from "@/lib/server/access-email";
import { publicCheckoutInputSchema } from "@/lib/validation/schemas";

describe("temporary password generation", () => {
  it("meets minimum length and character class requirements", () => {
    for (let i = 0; i < 50; i += 1) {
      const password = generateTemporaryPassword();
      expect(password.length).toBeGreaterThanOrEqual(GENERATED_PASSWORD_MIN_LENGTH);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[^a-zA-Z0-9]/);
      // No ambiguous characters.
      expect(password).not.toMatch(/[0O1lI]/);
    }
  });

  it("generates distinct passwords across calls", () => {
    const passwords = new Set<string>();
    for (let i = 0; i < 20; i += 1) passwords.add(generateTemporaryPassword());
    expect(passwords.size).toBeGreaterThan(1);
  });
});

describe("organization naming", () => {
  it("builds a slug and display name from the payer email", () => {
    const slug = buildOrganizationSlug("joao.silva@exemplo.com.br");
    expect(slug).toMatch(/^joao-silva-[a-z0-9]{2,8}$/);
    expect(buildOrganizationDisplayName("joao.silva@exemplo.com.br")).toBe("Joao Silva");
    expect(buildOrganizationDisplayName("a@b.co")).toBe("A");
  });
});

describe("checkout session external reference", () => {
  const MUTATION = "22222222-2222-4222-8222-222222222222";

  it("round-trips a public session reference", () => {
    const reference = buildCheckoutSessionExternalReference(MUTATION);
    expect(parseCheckoutSessionExternalReference(reference)).toEqual({
      clientMutationId: MUTATION,
    });
  });

  it("does not capture legacy authenticated references", () => {
    const legacy = parseAssinaturasExternalReference(
      `nex:org:11111111-1111-4111-8111-111111111111:mut:${MUTATION}`
    );
    expect(legacy).not.toBeNull();
    expect(
      parseCheckoutSessionExternalReference(
        `nex:org:11111111-1111-4111-8111-111111111111:mut:${MUTATION}`
      )
    ).toBeNull();
    expect(parseCheckoutSessionExternalReference("garbage")).toBeNull();
    expect(parseCheckoutSessionExternalReference(null)).toBeNull();
  });
});

describe("access email content", () => {
  it("embeds login URL, email, password and plan with a change-password instruction", () => {
    const content = buildAccessEmailContent({
      appOrigin: "https://nex.example.com/",
      email: "cliente@exemplo.com",
      temporaryPassword: "Senha-Temporal-9!",
      planName: "Profissional",
    });
    expect(content.subject).toContain("Nex Gestão Vendas");
    expect(content.text).toContain("https://nex.example.com/login");
    expect(content.text).toContain("cliente@exemplo.com");
    expect(content.text).toContain("Senha-Temporal-9!");
    expect(content.text).toContain("Profissional");
    expect(content.text).toContain("troque esta senha");
    expect(content.html).toContain("https://nex.example.com/login");
  });
});

describe("email sender config", () => {
  it("is unconfigured without API key or from address", () => {
    expect(getEmailSenderConfig({}).configured).toBe(false);
    expect(
      getEmailSenderConfig({ RESEND_API_KEY: "key" }).configured
    ).toBe(false);
    expect(
      getEmailSenderConfig({ RESEND_API_KEY: "key", EMAIL_FROM: "no-reply@nex.app" }).configured
    ).toBe(true);
  });
});

describe("public checkout input schema", () => {
  it("accepts email + plan and normalizes the email", () => {
    const parsed = publicCheckoutInputSchema.safeParse({
      plan_id: "11111111-1111-4111-8111-111111111111",
      payer_email: "  Cliente@Exemplo.COM ",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.payer_email).toBe("cliente@exemplo.com");
  });

  it("rejects invalid email and non-uuid plan", () => {
    expect(
      publicCheckoutInputSchema.safeParse({
        plan_id: "11111111-1111-4111-8111-111111111111",
        payer_email: "not-an-email",
      }).success
    ).toBe(false);
    expect(
      publicCheckoutInputSchema.safeParse({
        plan_id: "abc",
        payer_email: "cliente@exemplo.com",
      }).success
    ).toBe(false);
  });
});

describe("public checkout migration", () => {
  it("defines checkout_sessions with idempotency and deny-all RLS", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260918160000_public_checkout_sessions.sql"
      ),
      "utf8"
    );
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.checkout_sessions");
    expect(sql).toContain("client_mutation_id uuid NOT NULL UNIQUE");
    expect(sql).toContain("mark_checkout_session_onboarded");
    expect(sql).toContain("replay', true");
    expect(sql).toContain("TO service_role");
    expect(sql).not.toContain("GRANT ALL ON TABLE public.checkout_sessions TO anon");
  });

  it("keeps the distributed onboarding claim in a separate unapplied migration", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260918170000_public_checkout_onboarding_claim.sql"
      ),
      "utf8"
    );
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS mp_preapproval_id text");
    expect(sql).toContain("onboarding_status IN ('in_progress', 'completed', 'failed')");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.claim_checkout_session_onboarding");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.save_checkout_session_onboarding");
    expect(sql).toContain("onboarding_status = 'completed'");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.claim_checkout_session_onboarding");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.save_checkout_session_onboarding");
  });
});

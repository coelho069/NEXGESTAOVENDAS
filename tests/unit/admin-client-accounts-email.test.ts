import { describe, expect, it } from "vitest";
import {
  ACCOUNT_INVITE_EMAIL_SUBJECT,
  buildAccountInviteEmailContent,
  normalizeActivationOrigin,
} from "@/lib/domain/admin-client-accounts";
import {
  buildRfc2822Message,
  getGmailInviteConfig,
  resetGmailTokenCacheForTests,
} from "@/lib/server/gmail-invite-sender";

const ACTIVATION_URL =
  "https://app.nexgestaovendas.com.br/auth/v1/verify?token=abc123&type=invite&redirect_to=https%3A%2F%2Fapp.nexgestaovendas.com.br%2Fativar-conta";

describe("invitation e-mail content", () => {
  const content = buildAccountInviteEmailContent({
    fullName: "Maria Souza",
    email: "maria@empresa.com.br",
    companyName: "Souza Varejo",
    planName: "Plano Pro",
    activationUrl: ACTIVATION_URL,
    expiresAt: "2026-10-06T12:00:00.000Z",
    supportEmail: "suporte@nexgestaovendas.com.br",
  });

  it("uses the agreed subject", () => {
    expect(content.subject).toBe(ACCOUNT_INVITE_EMAIL_SUBJECT);
    expect(content.subject).toContain("NEXGESTAOVENDAS");
  });

  it("greets the client by name and includes company, plan and expiry", () => {
    expect(content.text).toContain("Maria");
    expect(content.text).toContain("Souza Varejo");
    expect(content.text).toContain("Plano Pro");
    expect(content.html).toContain("Maria");
    expect(content.html).toContain("Souza Varejo");
    expect(content.html).toContain("Plano Pro");
    expect(content.text.toLocaleLowerCase("pt-BR")).toContain("válido até");
  });

  it("includes the activation link as a button and as a plain-text URL", () => {
    expect(content.html).toContain('href="https://app.nexgestaovendas.com.br/auth/v1/verify');
    expect(content.text).toContain("https://app.nexgestaovendas.com.br/auth/v1/verify");
  });

  it("carries the security guidance and support channel", () => {
    expect(content.html).toContain("não compartilhe este link");
    expect(content.text).toContain("não compartilhe este link");
    expect(content.html).toContain("suporte@nexgestaovendas.com.br");
  });

  it("never sends a password", () => {
    expect(content.text.toLowerCase()).not.toContain("senha:");
    expect(content.html.toLowerCase()).not.toContain("senha inicial");
    expect(content.text.toLowerCase()).not.toContain("senha tempor");
  });

  it("omits optional fields cleanly", () => {
    const minimal = buildAccountInviteEmailContent({
      fullName: "João Lima",
      email: "joao@empresa.com.br",
      activationUrl: ACTIVATION_URL,
      expiresAt: null,
    });
    expect(minimal.text).not.toContain("Empresa:");
    expect(minimal.text).not.toContain("Plano contratado");
    expect(minimal.text).toContain("prazo de validade");
    expect(minimal.html).not.toContain("mailto:");
  });

  it("escapes HTML injected through admin-supplied fields", () => {
    const hostile = buildAccountInviteEmailContent({
      fullName: '<img src=x onerror="alert(1)">',
      email: "x@empresa.com.br",
      companyName: "<script>alert(2)</script>",
      activationUrl: ACTIVATION_URL,
      expiresAt: null,
    });

    expect(hostile.html).not.toContain("<script>");
    expect(hostile.html).not.toContain("onerror=");
    expect(hostile.html).toContain("&lt;script&gt;");
  });

  it("refuses non-https activation links", () => {
    expect(() =>
      buildAccountInviteEmailContent({
        fullName: "Maria",
        email: "maria@empresa.com.br",
        activationUrl: "http://app.nexgestaovendas.com.br/ativar",
        expiresAt: null,
      })
    ).toThrow(/https/);
  });
});

describe("activation origin normalization", () => {
  it("strips trailing slashes and keeps the https origin", () => {
    expect(normalizeActivationOrigin("https://app.nexgestaovendas.com.br/")).toBe(
      "https://app.nexgestaovendas.com.br"
    );
  });

  it("rejects http and credential-bearing origins", () => {
    expect(() => normalizeActivationOrigin("http://app.example.com")).toThrow(/https/);
    expect(() => normalizeActivationOrigin("https://user:pass@app.example.com")).toThrow(
      /credentials/
    );
  });
});

describe("gmail sender configuration", () => {
  it("stays disabled until explicitly enabled", () => {
    resetGmailTokenCacheForTests();
    const config = getGmailInviteConfig({});
    expect(config).toEqual({ configured: false, reason: "gmail_sender_disabled" });
  });

  it("requires full OAuth credentials when enabled", () => {
    expect(
      getGmailInviteConfig({ GMAIL_INVITE_ENABLED: "true", GMAIL_SENDER_ADDRESS: "a@b.com" })
    ).toEqual({ configured: false, reason: "gmail_oauth_credentials_missing" });
  });

  it("rejects a malformed sender address", () => {
    expect(
      getGmailInviteConfig({
        GMAIL_INVITE_ENABLED: "true",
        GMAIL_SENDER_ADDRESS: "not-an-email",
        GMAIL_OAUTH_CLIENT_ID: "id",
        GMAIL_OAUTH_CLIENT_SECRET: "secret",
        GMAIL_OAUTH_REFRESH_TOKEN: "refresh",
      })
    ).toEqual({ configured: false, reason: "gmail_sender_invalid" });
  });

  it("configures with all credentials present", () => {
    const config = getGmailInviteConfig({
      GMAIL_INVITE_ENABLED: "true",
      GMAIL_SENDER_ADDRESS: "contato@nexgestaovendas.com.br",
      GMAIL_OAUTH_CLIENT_ID: "id",
      GMAIL_OAUTH_CLIENT_SECRET: "secret",
      GMAIL_OAUTH_REFRESH_TOKEN: "refresh",
      GMAIL_TIMEOUT_MS: "9000",
    });

    expect(config.configured).toBe(true);
    if (config.configured) {
      expect(config.sender).toBe("contato@nexgestaovendas.com.br");
      expect(config.timeoutMs).toBe(9000);
    }
  });
});

describe("RFC 2822 message", () => {
  it("encodes the accented subject and both bodies", () => {
    const message = buildRfc2822Message({
      from: "contato@nexgestaovendas.com.br",
      to: "maria@empresa.com.br",
      subject: ACCOUNT_INVITE_EMAIL_SUBJECT,
      html: "<p>Olá</p>",
      text: "Olá",
    });

    // RFC 2047 base64 subject keeps accents intact.
    expect(message).toContain("Subject: =?UTF-8?B?");
    expect(message).toContain("multipart/alternative");
    expect(message).toContain(Buffer.from("<p>Olá</p>", "utf8").toString("base64"));
    expect(message).toContain(Buffer.from("Olá", "utf8").toString("base64"));
  });
});

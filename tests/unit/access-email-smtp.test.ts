import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getEmailSenderConfig,
  sendAccessEmail,
  setSmtpDeliveryForTests,
  type SmtpDeliveryInput,
} from "@/lib/server/access-email";

const CONTENT = {
  subject: "Acesso NEXGESTAOVENDAS",
  text: "https://nex.example.com/auth/v1/verify?token=secret",
  html: "<a href=\"https://nex.example.com/auth/v1/verify?token=secret\">ativar</a>",
};

const SMTP_ENV = {
  SMTP_HOST: "smtp.hostinger.com",
  SMTP_PORT: "465",
  SMTP_SECURE: "true",
  SMTP_USER: "nexgestaovendas@nexgestaovendas.com.br",
  SMTP_PASSWORD: "smtp-secret",
  EMAIL_FROM: "Nex Gestão <contato@nexgestaovendas.com.br>",
  RESEND_API_KEY: "re_test",
};

afterEach(() => {
  setSmtpDeliveryForTests(null);
  vi.unstubAllGlobals();
});

describe("getEmailSenderConfig", () => {
  it("prefers a complete Hostinger SMTP setup over Resend", () => {
    const config = getEmailSenderConfig(SMTP_ENV);
    expect(config.configured).toBe(true);
    if (!config.configured) return;
    expect(config.provider).toBe("smtp");
    if (config.provider !== "smtp") return;
    expect(config.host).toBe("smtp.hostinger.com");
    expect(config.port).toBe(465);
    expect(config.secure).toBe(true);
    expect(config.user).toBe("nexgestaovendas@nexgestaovendas.com.br");
    expect(config.from).toBe("Nex Gestão <contato@nexgestaovendas.com.br>");
    expect(config.user).not.toBe("contato@nexgestaovendas.com.br");
  });

  it("keeps Resend when no SMTP variable is present", () => {
    const config = getEmailSenderConfig({
      RESEND_API_KEY: "re_test",
      EMAIL_FROM: "no-reply@nex.app",
    });
    expect(config).toMatchObject({
      configured: true,
      provider: "resend",
      apiKey: "re_test",
      from: "no-reply@nex.app",
    });
  });

  it("fails closed on a partial SMTP setup instead of falling back to Resend", () => {
    const config = getEmailSenderConfig({
      SMTP_HOST: "smtp.hostinger.com",
      RESEND_API_KEY: "re_test",
      EMAIL_FROM: "contato@nexgestaovendas.com.br",
    });
    expect(config).toEqual({ configured: false, reason: "smtp_port_invalid" });
  });

  it("rejects implicit TLS disabled on port 465", () => {
    const config = getEmailSenderConfig({ ...SMTP_ENV, SMTP_SECURE: "false" });
    expect(config).toEqual({ configured: false, reason: "smtp_secure_mismatch" });
  });

  it("rejects an auth user that is not a mailbox", () => {
    const config = getEmailSenderConfig({ ...SMTP_ENV, SMTP_USER: "contato" });
    expect(config).toEqual({ configured: false, reason: "smtp_user_invalid" });
  });
});

describe("sendAccessEmail", () => {
  it("authenticates with SMTP_USER and sends From as the alias", async () => {
    const delivered: SmtpDeliveryInput[] = [];
    setSmtpDeliveryForTests(async (input) => {
      delivered.push(input);
      return { messageId: "<smtp-1@hostinger>" };
    });
    const config = getEmailSenderConfig(SMTP_ENV);
    const result = await sendAccessEmail({
      to: "cliente@exemplo.com",
      content: CONTENT,
      config,
      idempotencyKey: "nex-onboarding/abc",
    });

    expect(result).toEqual({ ok: true, emailId: "<smtp-1@hostinger>" });
    expect(delivered).toHaveLength(1);
    expect(delivered[0].user).toBe("nexgestaovendas@nexgestaovendas.com.br");
    expect(delivered[0].password).toBe("smtp-secret");
    expect(delivered[0].from).toBe("Nex Gestão <contato@nexgestaovendas.com.br>");
    expect(delivered[0].secure).toBe(true);
    expect(delivered[0].port).toBe(465);
    expect(delivered[0].subject).toBe(CONTENT.subject);
  });

  it("still posts to Resend when SMTP is not configured", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "re_email_1" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const config = getEmailSenderConfig({
      RESEND_API_KEY: "re_test",
      EMAIL_FROM: "no-reply@nex.app",
    });
    const result = await sendAccessEmail({
      to: "cliente@exemplo.com",
      content: CONTENT,
      config,
      idempotencyKey: "nex-onboarding/abc",
    });

    expect(result).toEqual({ ok: true, emailId: "re_email_1" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer re_test",
      "Idempotency-Key": "nex-onboarding/abc",
    });
    const body = JSON.parse(String(init.body));
    expect(body.from).toBe("no-reply@nex.app");
    expect(body.to).toEqual(["cliente@exemplo.com"]);
  });

  it("returns a coarse SMTP error and does not include the password", async () => {
    setSmtpDeliveryForTests(async () => {
      throw Object.assign(new Error("535 auth failed for smtp-secret"), { code: "EAUTH" });
    });
    const result = await sendAccessEmail({
      to: "cliente@exemplo.com",
      content: CONTENT,
      config: getEmailSenderConfig(SMTP_ENV),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("access_email_smtp_failed");
    expect(result.error).not.toContain("smtp-secret");
  });
});

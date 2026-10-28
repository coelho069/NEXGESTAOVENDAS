import { describe, expect, it } from "vitest";
import { buildPasswordRecoveryEmailContent } from "@/lib/domain/password-recovery-email";

const LINK = "https://vjhdnynsbxjkqjomugww.supabase.co/auth/v1/verify?token=abc&type=recovery";

describe("buildPasswordRecoveryEmailContent", () => {
  it("aceita link do app com token_hash", () => {
    const link = "https://nexgestaovendas.com.br/redefinir-senha?token_hash=abc&type=recovery";
    const content = buildPasswordRecoveryEmailContent({ actionLink: link, supportEmail: "a@b.c" });
    expect(content.text).toContain(link);
  });

  it("inclui o link de recuperação em texto e HTML", () => {
    const content = buildPasswordRecoveryEmailContent({ actionLink: LINK, supportEmail: "suporte@nexgestaovendas.com.br" });
    expect(content.text).toContain(LINK);
    expect(content.html).toContain(LINK.replace(/&/g, "&amp;"));
    expect(content.subject).toMatch(/senha/i);
    expect(content.text).toContain("suporte@nexgestaovendas.com.br");
  });

  it("recusa link que não é https", () => {
    expect(() =>
      buildPasswordRecoveryEmailContent({ actionLink: "http://evil.example/verify", supportEmail: "a@b.c" })
    ).toThrow("recovery_link_must_be_https");
  });

  it("escapa o suporte no HTML", () => {
    const content = buildPasswordRecoveryEmailContent({ actionLink: LINK, supportEmail: '"><script>x</script>' });
    expect(content.html).not.toContain("<script>x</script>");
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { trustedClientIp } from "@/lib/security/client-ip";
import { clientRateLimitKey } from "@/lib/security/rate-limit";

const originalTrustProxy = process.env.TRUST_PROXY;

function headersWith(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe("trustedClientIp", () => {
  beforeEach(() => {
    delete process.env.TRUST_PROXY;
  });
  afterEach(() => {
    if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = originalTrustProxy;
  });

  it("sem TRUST_PROXY=1 ignora X-Forwarded-For por completo", () => {
    expect(trustedClientIp(headersWith({ "x-forwarded-for": "203.0.113.9" }))).toBeNull();
  });

  it("com TRUST_PROXY=1 usa o último hop, o único anexado pelo proxy", () => {
    process.env.TRUST_PROXY = "1";
    expect(trustedClientIp(headersWith({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(
      trustedClientIp(headersWith({ "x-forwarded-for": "10.0.0.5 , 192.0.2.44" }))
    ).toBe("192.0.2.44");
  });

  it("cliente forjando o cabeçalho não escolhe o IP usado", () => {
    process.env.TRUST_PROXY = "1";
    expect(
      trustedClientIp(headersWith({ "x-forwarded-for": "1.2.3.4, 198.51.100.77" }))
    ).toBe("198.51.100.77");
  });

  it("sem cabeçalho de proxy não há IP", () => {
    process.env.TRUST_PROXY = "1";
    expect(trustedClientIp(headersWith({}))).toBeNull();
  });

  it("rejeita valor que não parece IP", () => {
    process.env.TRUST_PROXY = "1";
    expect(trustedClientIp(headersWith({ "x-forwarded-for": "not-an-ip" }))).toBeNull();
    expect(trustedClientIp(headersWith({ "x-forwarded-for": "1.1.1.1, <script>" }))).toBeNull();
  });

  it("aceita IPv6", () => {
    process.env.TRUST_PROXY = "1";
    expect(trustedClientIp(headersWith({ "x-forwarded-for": "2001:db8::10" }))).toBe("2001:db8::10");
  });
});

describe("clientRateLimitKey — isolamento por cliente", () => {
  beforeEach(() => {
    delete process.env.TRUST_PROXY;
  });
  afterEach(() => {
    if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = originalTrustProxy;
  });

  const req = (xff?: string) =>
    new Request("https://app.example.test/api/subscriptions/mercadopago/public-checkout", {
      method: "POST",
      headers: xff ? { "x-forwarded-for": xff } : {},
    });

  it("sem proxy confiável, todos os anônimos caem no mesmo balde coarse", () => {
    expect(clientRateLimitKey(req("203.0.113.9"), "s")).toBe("s:untrusted");
    expect(clientRateLimitKey(req(), "s")).toBe("s:untrusted");
  });

  it("com proxy confiável, clientes diferentes têm baldes diferentes", () => {
    process.env.TRUST_PROXY = "1";
    const a = clientRateLimitKey(req("9.9.9.9, 198.51.100.1"), "s");
    const b = clientRateLimitKey(req("9.9.9.9, 198.51.100.2"), "s");
    expect(a).toBe("s:ip:198.51.100.1");
    expect(b).toBe("s:ip:198.51.100.2");
    expect(a).not.toBe(b);
  });

  it("forjar XFF com IPs novos não cria baldes novos", () => {
    process.env.TRUST_PROXY = "1";
    const first = clientRateLimitKey(req("1.1.1.1, 198.51.100.1"), "s");
    const forged = clientRateLimitKey(req("2.2.2.2, 198.51.100.1"), "s");
    expect(forged).toBe(first);
  });

  it("sem cabeçalho com TRUST_PROXY=1 cai no balde coarse, não em chave 'unknown'", () => {
    process.env.TRUST_PROXY = "1";
    expect(clientRateLimitKey(req(), "s")).toBe("s:untrusted");
  });

  it("subject autenticado tem precedência sobre o IP", () => {
    process.env.TRUST_PROXY = "1";
    expect(clientRateLimitKey(req("198.51.100.1"), "s", "user-1")).toBe("s:sub:user-1");
  });
});

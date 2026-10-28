import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
  blockedMessage,
  clearLoginFailures,
  loginBlockedSeconds,
  loginLimiterKeys,
  normalizeLoginEmail,
  recordLoginFailure,
  requestClientIp,
  resetLoginLimiterForTests,
} from "@/lib/security/login-limiter";

describe("login limiter", () => {
  const keys = ["login:email:a@b.com", "login:ip:1.1.1.1"];
  beforeEach(() => resetLoginLimiterForTests());

  it("bloqueia só na 5ª falha", () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) recordLoginFailure(keys, 0);
    expect(loginBlockedSeconds(keys, 1)).toBe(0);
    recordLoginFailure(keys, 0);
    expect(loginBlockedSeconds(keys, 1000)).toBeGreaterThan(0);
  });

  it("libera após a janela de 10 min", () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) recordLoginFailure(keys, 0);
    expect(loginBlockedSeconds(keys, LOGIN_WINDOW_MS + 1)).toBe(0);
  });

  it("login ok zera o contador do e-mail", () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) recordLoginFailure([keys[0]], 0);
    clearLoginFailures([keys[0]]);
    expect(loginBlockedSeconds([keys[0]], 1)).toBe(0);
  });

  it("normaliza e formata mensagem", () => {
    expect(normalizeLoginEmail("  A@B.com ")).toBe("a@b.com");
    expect(blockedMessage(600)).toBe("Muitas tentativas. Tente novamente em 10 minutos.");
    expect(blockedMessage(30)).toBe("Muitas tentativas. Tente novamente em 1 minuto.");
  });
});

describe("login limiter — chave de IP", () => {
  const originalTrustProxy = process.env.TRUST_PROXY;
  const req = (headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/auth/login", { method: "POST", headers });

  beforeEach(() => {
    resetLoginLimiterForTests();
    delete process.env.TRUST_PROXY;
  });
  afterEach(() => {
    if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = originalTrustProxy;
  });

  it("com TRUST_PROXY=1 usa o último IP do X-Forwarded-For (acrescentado pelo proxy)", () => {
    process.env.TRUST_PROXY = "1";
    expect(requestClientIp(req({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(loginLimiterKeys("a@b.com", req({ "x-forwarded-for": "203.0.113.7" }))).toEqual([
      "login:email:a@b.com",
      "login:ip:203.0.113.7",
    ]);
  });

  it("ignora IP forjado pelo cliente: só o valor anexado pelo proxy conta", () => {
    process.env.TRUST_PROXY = "1";
    // cliente envia "9.9.9.9"; o proxy acrescenta o IP real (198.51.100.2) no fim
    expect(requestClientIp(req({ "x-forwarded-for": "9.9.9.9, 198.51.100.2" }))).toBe("198.51.100.2");
    expect(requestClientIp(req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 198.51.100.2" }))).toBe(
      "198.51.100.2"
    );
  });

  it("X-Real-IP não é lido nem com TRUST_PROXY=1", () => {
    process.env.TRUST_PROXY = "1";
    expect(requestClientIp(req({ "x-real-ip": "198.51.100.2" }))).toBeNull();
  });

  it("com TRUST_PROXY=1 e sem X-Forwarded-For não há IP confiável", () => {
    process.env.TRUST_PROXY = "1";
    expect(requestClientIp(req())).toBeNull();
  });

  it("valor anexado que não é IP não vira chave de limite", () => {
    process.env.TRUST_PROXY = "1";
    expect(requestClientIp(req({ "x-forwarded-for": "203.0.113.7, evil key;drop" }))).toBeNull();
  });

  it("sem IP confiável não gera chave de IP compartilhada", () => {
    expect(requestClientIp(req({ "x-forwarded-for": "203.0.113.7" }))).toBeNull();
    expect(loginLimiterKeys("a@b.com", req())).toEqual(["login:email:a@b.com"]);
  });

  it("sem IP confiável, 5 falhas de uma conta não bloqueiam outra conta", () => {
    const attacker = loginLimiterKeys("vitima@b.com", req());
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) recordLoginFailure(attacker, 0);
    expect(loginBlockedSeconds(loginLimiterKeys("vitima@b.com", req()), 1)).toBeGreaterThan(0);
    expect(loginBlockedSeconds(loginLimiterKeys("outro@b.com", req()), 1)).toBe(0);
  });

  it("sem IP confiável, o bloqueio por conta continua valendo", () => {
    const keys = loginLimiterKeys("a@b.com", req());
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) recordLoginFailure(keys, 0);
    expect(loginBlockedSeconds(loginLimiterKeys("a@b.com", req({ "x-forwarded-for": "9.9.9.9" })), 1)).toBeGreaterThan(0);
    expect(loginBlockedSeconds(loginLimiterKeys("a@b.com", req()), LOGIN_WINDOW_MS + 1)).toBe(0);
  });
});

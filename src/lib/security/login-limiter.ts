import { trustedClientIp } from "./client-ip";

/**
 * Limitador de FALHAS de login (em memória, processo único — mesma limitação de rate-limit.ts).
 * Conta só falhas; login bem-sucedido zera o contador do e-mail.
 */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 10 * 60 * 1000;

type Entry = { count: number; resetAt: number };
const failures = new Map<string, Entry>();

export function normalizeLoginEmail(email: string): string {
  return email.trim().toLowerCase();
}

function prune(now: number): void {
  if (failures.size < 5000) return;
  for (const [key, entry] of failures) {
    if (entry.resetAt <= now) failures.delete(key);
  }
}

/** Retorna segundos de espera (>0) se alguma chave já estourou o limite; 0 se liberado. */
export function loginBlockedSeconds(keys: string[], now = Date.now()): number {
  let wait = 0;
  for (const key of keys) {
    const entry = failures.get(key);
    if (!entry) continue;
    if (entry.resetAt <= now) {
      failures.delete(key);
      continue;
    }
    if (entry.count >= LOGIN_MAX_FAILURES) {
      wait = Math.max(wait, Math.ceil((entry.resetAt - now) / 1000));
    }
  }
  return wait;
}

export function recordLoginFailure(keys: string[], now = Date.now()): void {
  prune(now);
  for (const key of keys) {
    const entry = failures.get(key);
    if (!entry || entry.resetAt <= now) {
      failures.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    } else {
      entry.count += 1;
    }
  }
}

export function clearLoginFailures(keys: string[]): void {
  for (const key of keys) failures.delete(key);
}

export function resetLoginLimiterForTests(): void {
  failures.clear();
}

/**
 * IP do cliente só é confiável com TRUST_PROXY=1 (proxy que sanitiza X-Forwarded-For).
 * Sem isso devolve null: NÃO se usa uma chave compartilhada ("untrusted"), senão
 * 5 falhas de qualquer pessoa bloqueariam o login de todos. Nesse caso o limite
 * por conta (login:email:*) continua valendo como proteção contra brute force.
 */
export function requestClientIp(request: Request): string | null {
  return trustedClientIp(request.headers);
}

/** Chaves do limitador de login: sempre por conta; por IP só quando o IP é confiável. */
export function loginLimiterKeys(email: string, request: Request): string[] {
  const keys = [`login:email:${email}`];
  const ip = requestClientIp(request);
  if (ip) keys.push(`login:ip:${ip}`);
  return keys;
}

export function blockedMessage(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Muitas tentativas. Tente novamente em ${minutes} ${minutes === 1 ? "minuto" : "minutos"}.`;
}

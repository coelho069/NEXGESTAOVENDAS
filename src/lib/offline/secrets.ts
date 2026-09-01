const FORBIDDEN_KEY_EXACT = new Set([
  "token",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "pan",
  "cvv",
  "cvc",
  "cardnumber",
  "card_number",
  "securitycode",
  "security_code",
  "password",
  "supabase_service_role_key",
]);

export function isForbiddenSecretKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (FORBIDDEN_KEY_EXACT.has(normalized)) return true;
  if (normalized === "pan" || normalized.endsWith("_pan")) return true;
  if (normalized.includes("cvv") || normalized.includes("cvc")) return true;
  if (normalized === "token" || normalized.endsWith("_token") || normalized.endsWith("token")) {
    if (normalized.includes("mutation")) return false;
    return normalized === "token" || normalized.endsWith("token");
  }
  return false;
}

export function stripSecrets<T>(value: T): T {
  return stripSecretsInner(value) as T;
}

function stripSecretsInner(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripSecretsInner);
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenSecretKey(key)) continue;
      result[key] = stripSecretsInner(nested);
    }
    return result;
  }
  return value;
}

export function collectSecretKeys(value: unknown, path = "root"): string[] {
  const found: string[] = [];
  walk(value, path, found);
  return found;
}

function walk(value: unknown, path: string, found: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, found));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const next = `${path}.${key}`;
      if (isForbiddenSecretKey(key)) found.push(next);
      walk(nested, next, found);
    }
  }
}

export function assertNoSecrets(value: unknown, label = "state"): void {
  const keys = collectSecretKeys(value);
  if (keys.length > 0) {
    throw new Error(`${label} contains forbidden secrets: ${keys.join(", ")}`);
  }
}

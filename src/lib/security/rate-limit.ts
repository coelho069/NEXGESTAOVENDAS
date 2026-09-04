/**
 * Process-local request limiter for sensitive endpoints.
 *
 * Limitation: counters live in memory of a single Node process. Multi-instance
 * deployments MUST enforce distributed quotas at the edge/proxy (see README).
 * This helper is defense-in-depth for single-instance and local production-like
 * runs; it never replaces edge rate limiting.
 */

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
};

export function consumeRateLimit(input: {
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
}): RateLimitResult {
  const now = input.now ?? Date.now();
  const existing = buckets.get(input.key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(input.key, { count: 1, resetAt: now + input.windowMs });
    return {
      allowed: true,
      remaining: Math.max(0, input.limit - 1),
      retryAfterSec: Math.ceil(input.windowMs / 1000),
    };
  }

  if (existing.count >= input.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  buckets.set(input.key, existing);
  return {
    allowed: true,
    remaining: Math.max(0, input.limit - existing.count),
    retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

export function resetRateLimitStateForTests(): void {
  buckets.clear();
}

/**
 * Build a rate-limit key.
 *
 * - Prefer an authenticated subject when the caller already resolved one.
 * - Do NOT trust X-Forwarded-For / X-Real-IP unless TRUST_PROXY=1 is set by the
 *   deployment that terminates TLS and sanitizes those headers.
 * - Fall back to a coarse bucket so unauthenticated abuse is still bounded.
 */
export function clientRateLimitKey(
  request: Request,
  scope: string,
  subject?: string | null
): string {
  if (subject && subject.trim()) {
    return `${scope}:sub:${subject.trim()}`;
  }

  const trustProxy = process.env.TRUST_PROXY === "1";
  if (trustProxy) {
    const forwarded = request.headers.get("x-forwarded-for");
    const ip =
      forwarded?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip")?.trim() ||
      "unknown";
    return `${scope}:ip:${ip}`;
  }

  return `${scope}:untrusted`;
}

export const CORRELATION_HEADER = "x-correlation-id";
export const REQUEST_ID_HEADER = "x-request-id";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mintCorrelationId(): string {
  // Prefer Web Crypto so this module stays Edge-middleware safe.
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function isValidCorrelationId(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return trimmed.length >= 8 && trimmed.length <= 128 && !/[\r\n]/.test(trimmed);
}

export function normalizeCorrelationId(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (trimmed && isValidCorrelationId(trimmed)) {
    if (UUID_RE.test(trimmed)) return trimmed.toLowerCase();
    return trimmed.slice(0, 128);
  }
  return mintCorrelationId();
}

export function readCorrelationId(headers: Headers): string {
  return normalizeCorrelationId(
    headers.get(CORRELATION_HEADER) ?? headers.get(REQUEST_ID_HEADER)
  );
}

export function applyCorrelationHeaders(
  headers: Headers,
  correlationId: string
): void {
  headers.set(CORRELATION_HEADER, correlationId);
  headers.set(REQUEST_ID_HEADER, correlationId);
}

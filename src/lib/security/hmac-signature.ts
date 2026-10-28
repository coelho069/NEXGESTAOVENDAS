import crypto from "crypto";

/**
 * Verify HMAC-SHA256 signature for offline sync payloads and transaction requests.
 */
export function verifyHmacSignature(
  payloadString: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader || !secret) return false;
  try {
    const computedSignature = crypto
      .createHmac("sha256", secret)
      .update(payloadString)
      .digest("hex");

    const sigBuf = Buffer.from(signatureHeader, "hex");
    const computedBuf = Buffer.from(computedSignature, "hex");

    if (sigBuf.length !== computedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(sigBuf, computedBuf);
  } catch {
    return false;
  }
}

/**
 * Generate HMAC-SHA256 signature for outgoing sync payloads.
 */
export function generateHmacSignature(payloadString: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payloadString).digest("hex");
}

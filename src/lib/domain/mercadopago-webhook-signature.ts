import { createHmac, timingSafeEqual } from "node:crypto";

export type MercadoPagoWebhookSignatureInput = {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  secret: string;
};

function parseSignatureHeader(header: string): { ts: string | null; hash: string | null } {
  let ts: string | null = null;
  let hash: string | null = null;
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "ts") ts = value;
    if (key === "v1") hash = value;
  }
  return { ts, hash };
}

function buildManifest(dataId: string | null, xRequestId: string | null, ts: string | null): string | null {
  if (!ts) return null;
  const parts: string[] = [];
  if (dataId) parts.push(`id:${dataId}`);
  if (xRequestId) parts.push(`request-id:${xRequestId}`);
  parts.push(`ts:${ts}`);
  return `${parts.join(";")};`;
}

export function verifyMercadoPagoWebhookSignature(input: MercadoPagoWebhookSignatureInput): void {
  if (!input.xSignature) {
    throw new Error("mercadopago_webhook_unsigned");
  }
  const { ts, hash } = parseSignatureHeader(input.xSignature);
  if (!hash) {
    throw new Error("mercadopago_webhook_invalid_signature");
  }

  const dataId = input.dataId?.trim().toLowerCase() ?? "";
  const manifest = buildManifest(dataId || null, input.xRequestId?.trim() || null, ts);
  if (!manifest) {
    throw new Error("mercadopago_webhook_invalid_signature");
  }

  const computed = createHmac("sha256", input.secret).update(manifest).digest("hex");
  const computedBuffer = Buffer.from(computed, "utf8");
  const hashBuffer = Buffer.from(hash, "utf8");
  if (computedBuffer.length !== hashBuffer.length || !timingSafeEqual(computedBuffer, hashBuffer)) {
    throw new Error("mercadopago_webhook_invalid_signature");
  }
}

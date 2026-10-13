import { MERCADOPAGO_API_BASE } from "@/lib/domain/mercadopago";
import { getMercadoPagoEnv } from "@/lib/server/mercadopago";

const PAYMENT_ID = /^\d{1,20}$/;
const REFUND_ID = /^\d{1,20}$/;
const HEADER_VALUE = /^[\u0020-\u007E]{1,200}$/;
const MESSAGE_LIMIT = 200;

export type LiveMercadoPagoRefundResult =
  | { ok: true; refundId: string; status: string; alreadyRefunded: boolean }
  | {
      ok: false;
      error: "mp_not_configured" | "mp_payment_not_refundable" | "mp_refund_failed" | "mp_refund_timeout";
      message?: string;
    };

type RefundEntry = { id: string; status: string };

class MercadoPagoRefundTimeout extends Error {
  constructor() {
    super("mp_refund_timeout");
    this.name = "MercadoPagoRefundTimeout";
  }
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

function numericId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    const text = String(value);
    return REFUND_ID.test(text) ? text : null;
  }
  if (typeof value === "string" && REFUND_ID.test(value)) return value;
  return null;
}

function readStatus(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const status = (value as { status?: unknown }).status;
  return typeof status === "string" ? status.trim().toLowerCase() : "";
}

function readRefundEntries(value: unknown): RefundEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: RefundEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const id = numericId((item as { id?: unknown }).id);
    if (!id) continue;
    entries.push({ id, status: readStatus(item) });
  }
  return entries;
}

function sanitizeMpMessage(raw: string, secret: string): string {
  let text = raw.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (secret) text = text.split(secret).join("");
  text = text
    .replace(/bearer\s+\S+/gi, "")
    .replace(/\b(?:APP_USR|TEST)-[A-Za-z0-9-]+/g, "")
    .replace(/\b[A-Za-z0-9+/_=-]{32,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > MESSAGE_LIMIT) text = text.slice(0, MESSAGE_LIMIT).trim();
  return text;
}

function providerMessage(body: unknown, secret: string, fallback: string): string {
  let raw = "";
  if (typeof body === "string") raw = body;
  else if (body && typeof body === "object") {
    const record = body as { message?: unknown; error?: unknown; cause?: unknown };
    const cause = Array.isArray(record.cause) ? record.cause[0] : null;
    const description =
      cause && typeof cause === "object" ? (cause as { description?: unknown }).description : undefined;
    if (typeof description === "string" && description.trim()) raw = description;
    else if (typeof record.message === "string" && record.message.trim()) raw = record.message;
    else if (typeof record.error === "string" && record.error.trim()) raw = record.error;
  }
  const cleaned = sanitizeMpMessage(raw, secret);
  return cleaned || fallback;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  const slice = text.length > 4000 ? text.slice(0, 4000) : text;
  try {
    return JSON.parse(slice) as unknown;
  } catch {
    return { message: slice.slice(0, MESSAGE_LIMIT) };
  }
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) throw new MercadoPagoRefundTimeout();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function failed(secret: string, body: unknown, fallback: string): LiveMercadoPagoRefundResult {
  return { ok: false, error: "mp_refund_failed", message: providerMessage(body, secret, fallback) };
}

/**
 * Full refund of one Mercado Pago payment.
 * A payment that is already refunded is not refunded again.
 */
export async function executeLiveMercadoPagoRefund(input: {
  mpPaymentId: string;
  idempotencyKey: string;
  fetchImpl?: typeof fetch;
}): Promise<LiveMercadoPagoRefundResult> {
  const env = getMercadoPagoEnv();
  if (!env.configured) return { ok: false, error: "mp_not_configured" };

  const mpPaymentId = input.mpPaymentId.trim();
  if (!PAYMENT_ID.test(mpPaymentId)) return { ok: false, error: "mp_payment_not_refundable" };
  if (!HEADER_VALUE.test(input.idempotencyKey)) {
    return { ok: false, error: "mp_refund_failed", message: "Chave de idempotência inválida." };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const paymentUrl = `${MERCADOPAGO_API_BASE}/v1/payments/${encodeURIComponent(mpPaymentId)}`;
  const refundsUrl = `${paymentUrl}/refunds`;
  const authHeaders = {
    Accept: "application/json",
    Authorization: `Bearer ${env.accessToken}`,
  };

  try {
    const paymentResponse = await fetchWithTimeout(
      fetchImpl,
      paymentUrl,
      { method: "GET", headers: authHeaders },
      env.timeoutMs
    );
    const paymentBody = await readBody(paymentResponse);
    if (!paymentResponse.ok) {
      if (paymentResponse.status === 404) return { ok: false, error: "mp_payment_not_refundable" };
      return failed(env.accessToken, paymentBody, "Não foi possível consultar o pagamento no Mercado Pago.");
    }

    const paymentStatus = readStatus(paymentBody);
    if (!paymentStatus) return { ok: false, error: "mp_payment_not_refundable" };

    const refundsResponse = await fetchWithTimeout(
      fetchImpl,
      refundsUrl,
      { method: "GET", headers: authHeaders },
      env.timeoutMs
    );
    const refundsBody = await readBody(refundsResponse);
    if (!refundsResponse.ok) {
      return failed(env.accessToken, refundsBody, "Não foi possível consultar estornos deste pagamento.");
    }
    if (!Array.isArray(refundsBody)) {
      return { ok: false, error: "mp_refund_failed", message: "Resposta de estornos inválida." };
    }

    const listed = readRefundEntries(refundsBody);
    const embedded = readRefundEntries(
      paymentBody && typeof paymentBody === "object" ? (paymentBody as { refunds?: unknown }).refunds : []
    );
    const existing = listed.length > 0 ? listed : embedded;
    if (paymentStatus === "refunded" || existing.length > 0) {
      const chosen = existing.find((entry) => entry.status === "approved") ?? existing[0];
      if (!chosen) {
        return {
          ok: false,
          error: "mp_refund_failed",
          message: "O pagamento já está estornado, mas o identificador não foi informado.",
        };
      }
      return {
        ok: true,
        refundId: chosen.id,
        status: chosen.status || paymentStatus,
        alreadyRefunded: true,
      };
    }

    if (paymentStatus !== "approved") return { ok: false, error: "mp_payment_not_refundable" };

    const refundResponse = await fetchWithTimeout(
      fetchImpl,
      refundsUrl,
      {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
          "X-Idempotency-Key": input.idempotencyKey,
        },
        body: "{}",
      },
      env.timeoutMs
    );
    const refundBody = await readBody(refundResponse);
    const refundStatus = readStatus(refundBody);
    const refundId = refundBody && typeof refundBody === "object" ? numericId((refundBody as { id?: unknown }).id) : null;
    if (refundResponse.ok && refundStatus === "approved" && refundId) {
      return { ok: true, refundId, status: refundStatus, alreadyRefunded: false };
    }
    return failed(env.accessToken, refundBody, "O Mercado Pago não confirmou o estorno.");
  } catch (error) {
    if (error instanceof MercadoPagoRefundTimeout || isAbortError(error)) {
      return { ok: false, error: "mp_refund_timeout" };
    }
    const message = error instanceof Error ? error.message : "";
    return {
      ok: false,
      error: "mp_refund_failed",
      message: sanitizeMpMessage(message, env.accessToken) || "Falha ao falar com o Mercado Pago.",
    };
  }
}

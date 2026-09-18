/**
 * Transactional email sender (server-only). Uses Resend HTTP API via fetch —
 * no SDK dependency. Never logs subject/body (they contain the temporary
 * password). Called exclusively from the post-confirmation onboarding path.
 */
import { createLogger } from "@/lib/observability/logger";
import type { AccessEmailContent } from "@/lib/domain/onboarding-visitor";

const logger = createLogger({ service: "nexgestaovendas", component: "email-sender" });

const RESEND_API_BASE = "https://api.resend.com";
const DEFAULT_TIMEOUT_MS = 15_000;

export type EmailSenderConfig =
  | { configured: true; apiKey: string; from: string; timeoutMs: number }
  | { configured: false; reason: string };

export function getEmailSenderConfig(
  envSource: Record<string, string | undefined> = process.env
): EmailSenderConfig {
  const apiKey = envSource.RESEND_API_KEY?.trim() || "";
  if (!apiKey) {
    return { configured: false, reason: "email_sender_api_key_missing" };
  }
  const from = envSource.EMAIL_FROM?.trim() || "";
  if (!from) {
    return { configured: false, reason: "email_sender_from_missing" };
  }
  const parsedTimeout = Number.parseInt(
    envSource.EMAIL_SENDER_TIMEOUT_MS?.trim() || "",
    10
  );
  const timeoutMs = Number.isFinite(parsedTimeout)
    ? Math.min(Math.max(parsedTimeout, 1_000), 60_000)
    : DEFAULT_TIMEOUT_MS;
  return { configured: true, apiKey, from, timeoutMs };
}

export type SendEmailResult = { ok: true; emailId: string } | { ok: false; error: string };

/**
 * Sends a rendered email. Failures return { ok:false } — the onboarding layer
 * decides whether to persist onboarding_error for retry. No plaintext password
 * or full content is ever written to logs.
 */
export async function sendAccessEmail(input: {
  to: string;
  content: AccessEmailContent;
  config: EmailSenderConfig;
  idempotencyKey?: string;
}): Promise<SendEmailResult> {
  if (!input.config.configured) {
    return { ok: false, error: input.config.reason };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.config.timeoutMs);
  try {
    const response = await fetch(`${RESEND_API_BASE}/emails`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${input.config.apiKey}`,
        "Content-Type": "application/json",
        ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: input.config.from,
        to: [input.to],
        subject: input.content.subject,
        text: input.content.text,
        html: input.content.html,
      }),
    });
    if (!response.ok) {
      // Body may contain provider internals; only status + provider error id surface.
      logger.warn("access_email_send_failed", { http_status: response.status });
      return { ok: false, error: `access_email_send_failed_status_${response.status}` };
    }
    const body: unknown = await response.json();
    const emailId =
      body && typeof body === "object" && typeof (body as Record<string, unknown>).id === "string"
        ? ((body as Record<string, unknown>).id as string)
        : null;
    if (!emailId) {
      return { ok: false, error: "access_email_send_invalid_response" };
    }
    logger.info("access_email_sent", { email_id: emailId });
    return { ok: true, emailId };
  } catch {
    return { ok: false, error: "access_email_send_network_error" };
  } finally {
    clearTimeout(timeout);
  }
}

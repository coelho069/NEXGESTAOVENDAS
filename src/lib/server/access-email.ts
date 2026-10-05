/**
 * Transactional onboarding email sender (server-only).
 *
 * Preferred transport: Hostinger SMTP (implicit TLS on port 465).
 * Fallback: Resend HTTP API, used only when no SMTP variable is set.
 * Gmail OAuth stays in `gmail-invite-sender.ts` and is not used here.
 *
 * Authentication and the visible sender are different mailboxes:
 * `SMTP_USER` logs in; `EMAIL_FROM` is the From header. The alias in
 * `EMAIL_FROM` is never copied into SMTP auth.
 *
 * Never logs subject, body, password, or activation links.
 */
import nodemailer from "nodemailer";

import { createLogger } from "@/lib/observability/logger";
import type { AccessEmailContent } from "@/lib/domain/onboarding-visitor";

const logger = createLogger({ service: "nexgestaovendas", component: "email-sender" });

const RESEND_API_BASE = "https://api.resend.com";
const DEFAULT_TIMEOUT_MS = 15_000;

type EnvBag = Record<string, string | undefined>;

export type EmailSenderConfig =
  | {
      configured: true;
      provider: "smtp";
      host: string;
      port: number;
      secure: boolean;
      user: string;
      password: string;
      from: string;
      timeoutMs: number;
    }
  | {
      configured: true;
      provider: "resend";
      apiKey: string;
      from: string;
      timeoutMs: number;
    }
  | { configured: false; reason: string };

export type SmtpDeliveryInput = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  timeoutMs: number;
};

export type SmtpDelivery = (input: SmtpDeliveryInput) => Promise<{ messageId: string }>;

function readEnv(env: EnvBag, name: string): string {
  return env[name]?.trim() ?? "";
}

function timeoutMsFrom(env: EnvBag): number {
  const parsedTimeout = Number.parseInt(readEnv(env, "EMAIL_SENDER_TIMEOUT_MS"), 10);
  return Number.isFinite(parsedTimeout)
    ? Math.min(Math.max(parsedTimeout, 1_000), 60_000)
    : DEFAULT_TIMEOUT_MS;
}

function smtpIntentPresent(env: EnvBag): boolean {
  return ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASSWORD"].some(
    (name) => readEnv(env, name) !== ""
  );
}

function resolveSmtpConfig(env: EnvBag): EmailSenderConfig {
  const host = readEnv(env, "SMTP_HOST");
  const portRaw = readEnv(env, "SMTP_PORT");
  const secureRaw = readEnv(env, "SMTP_SECURE").toLowerCase();
  const user = readEnv(env, "SMTP_USER");
  const password = env.SMTP_PASSWORD ?? "";
  const from = readEnv(env, "EMAIL_FROM");

  if (!host) return { configured: false, reason: "smtp_host_missing" };
  const port = Number.parseInt(portRaw, 10);
  if (!portRaw || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { configured: false, reason: "smtp_port_invalid" };
  }
  if (secureRaw !== "true" && secureRaw !== "false") {
    return { configured: false, reason: "smtp_secure_invalid" };
  }
  const secure = secureRaw === "true";
  if (port === 465 && !secure) return { configured: false, reason: "smtp_secure_mismatch" };
  if (port === 587 && secure) return { configured: false, reason: "smtp_secure_mismatch" };
  if (!user || !user.includes("@")) return { configured: false, reason: "smtp_user_invalid" };
  if (!password) return { configured: false, reason: "smtp_password_missing" };
  if (!from || !from.includes("@")) return { configured: false, reason: "email_sender_from_missing" };

  return {
    configured: true,
    provider: "smtp",
    host,
    port,
    secure,
    user,
    password,
    from,
    timeoutMs: timeoutMsFrom(env),
  };
}

function resolveResendConfig(env: EnvBag): EmailSenderConfig {
  const apiKey = readEnv(env, "RESEND_API_KEY");
  if (!apiKey) return { configured: false, reason: "email_sender_api_key_missing" };
  const from = readEnv(env, "EMAIL_FROM");
  if (!from) return { configured: false, reason: "email_sender_from_missing" };
  return { configured: true, provider: "resend", apiKey, from, timeoutMs: timeoutMsFrom(env) };
}

/**
 * SMTP wins only when its variables are complete. A partial SMTP setup fails
 * closed and does not silently fall back to Resend. With no SMTP variables,
 * Resend remains the sender.
 */
export function getEmailSenderConfig(envSource: EnvBag = process.env): EmailSenderConfig {
  if (smtpIntentPresent(envSource)) return resolveSmtpConfig(envSource);
  return resolveResendConfig(envSource);
}

export type SendEmailResult = { ok: true; emailId: string } | { ok: false; error: string };

async function deliverWithNodemailer(input: SmtpDeliveryInput): Promise<{ messageId: string }> {
  const transporter = nodemailer.createTransport({
    host: input.host,
    port: input.port,
    secure: input.secure,
    auth: {
      user: input.user,
      pass: input.password,
    },
    connectionTimeout: input.timeoutMs,
    greetingTimeout: input.timeoutMs,
    socketTimeout: input.timeoutMs,
    tls: { minVersion: "TLSv1.2" },
  });
  try {
    const info = await transporter.sendMail({
      from: input.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    const messageId = typeof info.messageId === "string" ? info.messageId.trim() : "";
    if (!messageId) throw Object.assign(new Error("smtp_missing_message_id"), { code: "EMESSAGE" });
    return { messageId };
  } finally {
    transporter.close();
  }
}

let smtpDelivery: SmtpDelivery = deliverWithNodemailer;

/** Test seam. Production callers leave this unset. */
export function setSmtpDeliveryForTests(delivery: SmtpDelivery | null): void {
  smtpDelivery = delivery ?? deliverWithNodemailer;
}

function classifySmtpError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "");
    if (code === "ETIMEDOUT" || code === "ESOCKET" || code === "ECONNECTION") {
      return "access_email_smtp_timeout";
    }
  }
  return "access_email_smtp_failed";
}

async function sendViaResend(input: {
  to: string;
  content: AccessEmailContent;
  apiKey: string;
  from: string;
  timeoutMs: number;
  idempotencyKey?: string;
}): Promise<SendEmailResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch(`${RESEND_API_BASE}/emails`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        subject: input.content.subject,
        text: input.content.text,
        html: input.content.html,
      }),
    });
    if (!response.ok) {
      logger.warn("access_email_send_failed", { http_status: response.status, provider: "resend" });
      return { ok: false, error: `access_email_send_failed_status_${response.status}` };
    }
    const body: unknown = await response.json();
    const emailId =
      body && typeof body === "object" && typeof (body as Record<string, unknown>).id === "string"
        ? ((body as Record<string, unknown>).id as string)
        : null;
    if (!emailId) return { ok: false, error: "access_email_send_invalid_response" };
    logger.info("access_email_sent", { email_id: emailId, provider: "resend" });
    return { ok: true, emailId };
  } catch {
    return { ok: false, error: "access_email_send_network_error" };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Sends a rendered onboarding email. Failures return { ok:false } — the
 * onboarding layer decides whether to persist onboarding_error for retry.
 * SMTP has no provider idempotency key; the persisted sent-at marker is the
 * duplicate guard. Resend still receives `idempotencyKey` when present.
 */
export async function sendAccessEmail(input: {
  to: string;
  content: AccessEmailContent;
  config: EmailSenderConfig;
  idempotencyKey?: string;
}): Promise<SendEmailResult> {
  if (!input.config.configured) return { ok: false, error: input.config.reason };

  if (input.config.provider === "smtp") {
    try {
      const sent = await smtpDelivery({
        host: input.config.host,
        port: input.config.port,
        secure: input.config.secure,
        user: input.config.user,
        password: input.config.password,
        from: input.config.from,
        to: input.to,
        subject: input.content.subject,
        text: input.content.text,
        html: input.content.html,
        timeoutMs: input.config.timeoutMs,
      });
      logger.info("access_email_sent", { email_id: sent.messageId, provider: "smtp" });
      return { ok: true, emailId: sent.messageId };
    } catch (error) {
      const errorCode = classifySmtpError(error);
      logger.warn("access_email_send_failed", { provider: "smtp", error_code: errorCode });
      return { ok: false, error: errorCode };
    }
  }

  return sendViaResend({
    to: input.to,
    content: input.content,
    apiKey: input.config.apiKey,
    from: input.config.from,
    timeoutMs: input.config.timeoutMs,
    idempotencyKey: input.idempotencyKey,
  });
}

/**
 * Gmail invitation sender (server-only).
 *
 * Transport: Gmail REST API (`gmail.googleapis.com`) with OAuth2 access tokens
 * obtained from a long-lived refresh token. Implemented with `fetch` only, to
 * match `src/lib/server/access-email.ts` and avoid introducing an SDK.
 *
 * Credentials live exclusively in server-only env vars. Nothing here is ever
 * exposed through a NEXT_PUBLIC_ variable, returned to the browser, or written
 * to logs: token material and message bodies are treated as secrets.
 *
 * Fail-closed: when the integration is not configured the caller receives a
 * typed `not_configured` reason and provisions nothing silently.
 */
import { createLogger } from "@/lib/observability/logger";

const logger = createLogger({ service: "nexgestaovendas", component: "gmail-invite-sender" });

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";

const DEFAULT_TIMEOUT_MS = 15_000;
/** Refresh slightly before actual expiry to avoid racing the expiry boundary. */
const TOKEN_EXPIRY_SAFETY_MS = 60_000;

type EnvBag = Record<string, string | undefined>;

function readEnv(env: EnvBag, name: string): string {
  return env[name]?.trim() ?? "";
}

export type GmailInviteConfig =
  | {
      configured: true;
      clientId: string;
      clientSecret: string;
      refreshToken: string;
      sender: string;
      timeoutMs: number;
    }
  | { configured: false; reason: GmailInviteConfigReason };

export type GmailInviteConfigReason =
  | "gmail_sender_disabled"
  | "gmail_sender_missing"
  | "gmail_oauth_credentials_missing"
  | "gmail_sender_invalid";

export function getGmailInviteConfig(envSource: EnvBag = process.env): GmailInviteConfig {
  // Explicit opt-in flag keeps the integration inert until credentials exist.
  if (readEnv(envSource, "GMAIL_INVITE_ENABLED") !== "true") {
    return { configured: false, reason: "gmail_sender_disabled" };
  }

  const sender = readEnv(envSource, "GMAIL_SENDER_ADDRESS");
  const clientId = readEnv(envSource, "GMAIL_OAUTH_CLIENT_ID");
  const clientSecret = readEnv(envSource, "GMAIL_OAUTH_CLIENT_SECRET");
  const refreshToken = readEnv(envSource, "GMAIL_OAUTH_REFRESH_TOKEN");

  if (!clientId || !clientSecret || !refreshToken) {
    return { configured: false, reason: "gmail_oauth_credentials_missing" };
  }
  if (!sender || !sender.includes("@")) {
    return { configured: false, reason: "gmail_sender_invalid" };
  }

  const parsed = Number.parseInt(readEnv(envSource, "GMAIL_TIMEOUT_MS"), 10);
  const timeoutMs = Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1_000), 60_000)
    : DEFAULT_TIMEOUT_MS;

  return { configured: true, clientId, clientSecret, refreshToken, sender, timeoutMs };
}

/** In-memory token cache. Process-local by design; tokens are never persisted. */
type CachedToken = { accessToken: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

export function resetGmailTokenCacheForTests(): void {
  cachedToken = null;
}

async function fetchAccessToken(
  config: Extract<GmailInviteConfig, { configured: true }>
): Promise<{ accessToken: string } | { error: string }> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - TOKEN_EXPIRY_SAFETY_MS > now) {
    return { accessToken: cachedToken.accessToken };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!response.ok) {
      // Never surface the provider body: it can echo credential material.
      logger.warn("gmail_token_exchange_failed", { http_status: response.status });
      return { error: `gmail_token_exchange_failed_status_${response.status}` };
    }
    const body: unknown = await response.json();
    const accessToken =
      body && typeof body === "object" && typeof (body as Record<string, unknown>).access_token === "string"
        ? ((body as Record<string, unknown>).access_token as string)
        : null;
    if (!accessToken) return { error: "gmail_token_exchange_invalid_response" };

    const expiresIn =
      body && typeof body === "object" && typeof (body as Record<string, unknown>).expires_in === "number"
        ? (body as Record<string, number>).expires_in as number
        : 3600;
    cachedToken = { accessToken, expiresAt: now + expiresIn * 1000 };
    return { accessToken };
  } catch {
    return { error: "gmail_token_exchange_network_error" };
  } finally {
    clearTimeout(timeout);
  }
}

/** RFC 2822 message with UTF-8 subject encoded per RFC 2047 (needed for accents). */
export function buildRfc2822Message(input: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}): string {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(input.subject, "utf8").toString("base64")}?=`;
  return [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    'Content-Type: multipart/alternative; boundary="nex-invite-boundary"',
    "",
    "--nex-invite-boundary",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(input.text, "utf8").toString("base64"),
    "",
    "--nex-invite-boundary",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(input.html, "utf8").toString("base64"),
    "",
    "--nex-invite-boundary--",
  ].join("\r\n");
}

export type GmailSendResult = { ok: true; messageId: string } | { ok: false; error: string };

/**
 * Sends one invitation. `idempotencyKey` is not supported by the Gmail API, so
 * callers must instead rely on the persisted invite state to avoid duplicate
 * deliveries (see src/lib/server/admin-client-account-invite.ts).
 */
export async function sendGmailInvite(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  config: GmailInviteConfig;
}): Promise<GmailSendResult> {
  if (!input.config.configured) {
    return { ok: false, error: input.config.reason };
  }

  const token = await fetchAccessToken(input.config);
  if ("error" in token) return { ok: false, error: token.error };

  const raw = buildRfc2822Message({
    from: input.config.sender,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.config.timeoutMs);
  try {
    const response = await fetch(GMAIL_SEND_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: Buffer.from(raw, "utf8").toString("base64url") }),
    });
    if (!response.ok) {
      logger.warn("gmail_invite_send_failed", { http_status: response.status });
      return { ok: false, error: `gmail_invite_send_failed_status_${response.status}` };
    }
    const body: unknown = await response.json();
    const messageId =
      body && typeof body === "object" && typeof (body as Record<string, unknown>).id === "string"
        ? ((body as Record<string, unknown>).id as string)
        : null;
    if (!messageId) return { ok: false, error: "gmail_invite_send_invalid_response" };

    // Only the provider message id is logged — never the recipient, body or link.
    logger.info("gmail_invite_sent", { gmail_message_id: messageId });
    return { ok: true, messageId };
  } catch {
    return { ok: false, error: "gmail_invite_send_network_error" };
  } finally {
    clearTimeout(timeout);
  }
}

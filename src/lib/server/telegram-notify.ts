/**
 * Optional Telegram admin notifications (server-only).
 * Fail-open: missing config returns { ok: false } without throwing.
 */
import { createLogger } from "@/lib/observability/logger";

const logger = createLogger({ service: "nexgestaovendas", component: "telegram-notify" });
const TELEGRAM_API_BASE = "https://api.telegram.org";
const DEFAULT_TIMEOUT_MS = 10_000;

export type TelegramNotifyConfig =
  | { configured: true; botToken: string; chatId: string; timeoutMs: number }
  | { configured: false; reason: string };

export function getTelegramNotifyConfig(
  envSource: Record<string, string | undefined> = process.env
): TelegramNotifyConfig {
  const botToken = envSource.TELEGRAM_BOT_TOKEN?.trim() || "";
  const chatId = envSource.TELEGRAM_CHAT_ID?.trim() || "";
  if (!botToken) return { configured: false, reason: "telegram_bot_token_missing" };
  if (!chatId) return { configured: false, reason: "telegram_chat_id_missing" };
  const parsedTimeout = Number.parseInt(envSource.TELEGRAM_TIMEOUT_MS?.trim() || "", 10);
  const timeoutMs = Number.isFinite(parsedTimeout)
    ? Math.min(Math.max(parsedTimeout, 1_000), 30_000)
    : DEFAULT_TIMEOUT_MS;
  return { configured: true, botToken, chatId, timeoutMs };
}

export type SendTelegramResult = { ok: true } | { ok: false; error: string };

export async function sendTelegramMessage(input: {
  text: string;
  config: TelegramNotifyConfig;
}): Promise<SendTelegramResult> {
  if (!input.config.configured) {
    return { ok: false, error: input.config.reason };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.config.timeoutMs);
  try {
    const response = await fetch(
      `${TELEGRAM_API_BASE}/bot${input.config.botToken}/sendMessage`,
      {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: input.config.chatId,
          text: input.text,
          disable_web_page_preview: true,
        }),
      }
    );
    if (!response.ok) {
      logger.warn("telegram_send_failed", { http_status: response.status });
      return { ok: false, error: `telegram_send_failed_status_${response.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "telegram_send_network_error" };
  } finally {
    clearTimeout(timeout);
  }
}

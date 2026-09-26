const SUPPORT_WHATSAPP_ENV = "NEXT_PUBLIC_SUPPORT_WHATSAPP_URL";

function normalizeWhatsAppBaseUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (host !== "wa.me" && host !== "api.whatsapp.com") return null;
    return url;
  } catch {
    return null;
  }
}

/** Fail-closed: returns null when env is unset or invalid. */
export function getSupportWhatsAppUrl(): string | null {
  const raw = process.env[SUPPORT_WHATSAPP_ENV]?.trim();
  if (!raw) return null;

  const url = normalizeWhatsAppBaseUrl(raw);
  if (!url) return null;

  return url.toString();
}

export { SUPPORT_WHATSAPP_ENV };

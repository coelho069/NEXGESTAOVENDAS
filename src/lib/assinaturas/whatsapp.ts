const ASSINATURAS_WHATSAPP_ENV = "NEXT_PUBLIC_ASSINATURAS_WHATSAPP_URL";

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
export function getAssinaturasWhatsAppUrl(planName?: string): string | null {
  const raw = process.env[ASSINATURAS_WHATSAPP_ENV]?.trim();
  if (!raw) return null;

  const url = normalizeWhatsAppBaseUrl(raw);
  if (!url) return null;

  if (planName?.trim()) {
    const message = `Olá! Tenho interesse no plano ${planName.trim()} do Nex Gestão Vendas.`;
    url.searchParams.set("text", message);
  }

  return url.toString();
}

export { ASSINATURAS_WHATSAPP_ENV };

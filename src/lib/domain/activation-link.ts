/**
 * Pure rules for `/ativar-conta`.
 *
 * A logged-in browser session is not an invitation. The password form may run
 * only for a client account that still needs a password, or for an already
 * activated account when this navigation itself carried a fresh access link.
 */
import type { ClientAccountStatus } from "@/lib/domain/admin-client-accounts";

const IMPLICIT_LINK_TYPES = new Set(["invite", "recovery", "magiclink", "signup"]);

/** HttpOnly marker set when /ativar-conta adopted a fresh invite or recovery link. */
export const ACTIVATION_LINK_COOKIE = "nx_activation_link";

export function describeActivationPasswordError(providerMessage: string): string {
  const text = providerMessage.toLowerCase();
  if (
    text.includes("weak") ||
    text.includes("easy to guess") ||
    text.includes("pwned") ||
    text.includes("leaked")
  ) {
    return "Essa senha é fácil de adivinhar. Escolha outra.";
  }
  if (text.includes("different from the old") || text.includes("same password")) {
    return "Escolha uma senha diferente da anterior.";
  }
  if (text.includes("at least") || text.includes("should be")) {
    return "A senha não atende aos requisitos mínimos.";
  }
  if (text.includes("expired") || text.includes("invalid") || text.includes("session")) {
    return "Este link expirou ou já foi utilizado. Solicite um novo envio ao suporte ou use a recuperação de senha em /login.";
  }
  return "Não foi possível definir a senha. Tente novamente.";
}

export type ActivationCallback =
  | { kind: "implicit"; accessToken: string; refreshToken: string; type: string }
  | { kind: "pkce"; code: string };

export function readActivationCallback(href: string): ActivationCallback | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const accessToken = hash.get("access_token")?.trim() ?? "";
  const refreshToken = hash.get("refresh_token")?.trim() ?? "";
  const type = hash.get("type")?.trim() ?? "";
  if (accessToken && refreshToken && IMPLICIT_LINK_TYPES.has(type)) {
    return { kind: "implicit", accessToken, refreshToken, type };
  }

  const code = url.searchParams.get("code")?.trim() ?? "";
  if (code.length >= 8 && code.length <= 2048) {
    return { kind: "pkce", code };
  }

  return null;
}

export function canDefineActivationPassword(
  status: ClientAccountStatus,
  freshAccessLink: boolean
): boolean {
  if (status === "suspended") return false;
  if (status === "activated") return freshAccessLink;
  return true;
}

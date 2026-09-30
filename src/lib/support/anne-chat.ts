import { createClient } from "@/lib/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";

export const ANNE_CHAT_MAX_MESSAGE_LENGTH = 2000;
export const ANNE_CONVERSA_STORAGE_KEY = "anne-support-conversa-id";

export const ANNE_SUPPORT_EMAIL = "suporte@nexgestaovendas.com.br";

export const ANNE_GREETING =
  "Oi! Sou a Anne, do suporte do NEX. Qual é a sua dúvida sobre o sistema? Se preferir falar com nossa equipe, entre em contato pelo e-mail suporte@nexgestaovendas.com.br.";

export const ANNE_GENERIC_ERROR =
  "Não foi possível enviar sua mensagem. Tente novamente em instantes.";

export type AnneChatResponse = {
  reply: string;
  conversa_id: string;
  encaminhado: boolean;
};

export type AnneChatRequest = {
  message: string;
  conversa_id?: string;
};

export type AnneChatResult =
  | { ok: true; data: AnneChatResponse }
  | { ok: false; unauthorized: true }
  | { ok: false; unauthorized: false; message: string };

const AUTHENTICATED_ROUTE_PREFIXES = [
  "/pdv",
  "/inventory",
  "/dashboard",
  "/clientes",
  "/suporte",
  "/admin",
] as const;

export function isAnneSupportRoute(pathname: string): boolean {
  return AUTHENTICATED_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function readStoredConversaId(userId: string | null): string | null {
  if (typeof window === "undefined" || !userId) return null;
  try {
    const raw = sessionStorage.getItem(`${ANNE_CONVERSA_STORAGE_KEY}:${userId}`);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function writeStoredConversaId(userId: string | null, conversaId: string | null): void {
  if (typeof window === "undefined" || !userId) return;
  const key = `${ANNE_CONVERSA_STORAGE_KEY}:${userId}`;
  try {
    if (!conversaId) {
      sessionStorage.removeItem(key);
      return;
    }
    sessionStorage.setItem(key, conversaId);
  } catch {
    // Ignore quota / privacy mode errors.
  }
}

function isAnneChatResponse(value: unknown): value is AnneChatResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.reply === "string";
}

async function readHttpErrorBody(error: FunctionsHttpError): Promise<unknown> {
  const context = error.context;
  if (context && typeof context === "object" && "json" in context) {
    const response = context as Response;
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  return null;
}

export async function sendAnneChatMessage(
  request: AnneChatRequest,
  client = createClient()
): Promise<AnneChatResult> {
  const trimmed = request.message.trim();
  if (!trimmed) {
    return { ok: false, unauthorized: false, message: "Digite uma mensagem antes de enviar." };
  }
  if (trimmed.length > ANNE_CHAT_MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      unauthorized: false,
      message: `A mensagem pode ter no máximo ${ANNE_CHAT_MAX_MESSAGE_LENGTH} caracteres.`,
    };
  }

  const body: AnneChatRequest = { message: trimmed };
  if (request.conversa_id) {
    body.conversa_id = request.conversa_id;
  }

  const { data, error } = await client.functions.invoke<AnneChatResponse>("anne-chat", { body });

  if (!error && isAnneChatResponse(data)) {
    return { ok: true, data };
  }

  if (error instanceof FunctionsHttpError) {
    const status = error.context?.status;
    if (status === 401) {
      return { ok: false, unauthorized: true };
    }

    const errorBody = await readHttpErrorBody(error);
    if (isAnneChatResponse(errorBody)) {
      return {
        ok: true,
        data: {
          reply: errorBody.reply,
          conversa_id: errorBody.conversa_id ?? request.conversa_id ?? "",
          encaminhado: errorBody.encaminhado ?? false,
        },
      };
    }
  }

  return { ok: false, unauthorized: false, message: ANNE_GENERIC_ERROR };
}

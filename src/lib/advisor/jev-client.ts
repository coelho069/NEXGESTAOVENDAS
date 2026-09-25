import type { AdvisorQuestions, AdvisorReport, AdvisorState } from "@/lib/advisor/types";
import { buildAdvisorPrompt } from "@/lib/advisor/prompt";

// ---------------------------------------------------------------------------
// Cliente do JEV (motor de análise).
//
// O JEV é um LLM acessado por HTTP server-side. A chamada é REAL: este módulo
// nunca simula resposta nem aplica regras fixas que substituam a análise.
// A validação estrutural da resposta acontece em validate.ts; aqui apenas
// transportamos STATE + QUESTIONS e devolvemos o JSON bruto do JEV.
// ---------------------------------------------------------------------------

export type JevClientConfig = {
  endpoint: string;
  apiKey: string;
  model?: string;
  timeoutMs?: number;
};

export type JevCallResult =
  | { ok: true; raw: string }
  | { ok: false; error: string; detail?: string };

export type JevRequestPayload = {
  prompt: string;
  model?: string;
  system?: string;
};

export class JevTransportError extends Error {
  readonly detail?: string;

  constructor(message: string, detail?: string) {
    super(message);
    this.name = "JevTransportError";
    this.detail = detail;
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Executa a chamada real ao JEV via POST HTTP.
 * O endpoint é definido por env no server (nunca hardcoded em client).
 */
export async function callJev(
  config: JevClientConfig,
  state: AdvisorState,
  questions: AdvisorQuestions
): Promise<JevCallResult> {
  const prompt = buildAdvisorPrompt(state, questions);
  const payload: JevRequestPayload = {
    prompt,
    ...(config.model ? { model: config.model } : {}),
  };

  const controller = new AbortController();
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => undefined);
      return {
        ok: false,
        error: `jev_http_${response.status}`,
        detail: detail?.slice(0, 500),
      };
    }

    const raw = await response.text();
    if (!raw.trim()) {
      return { ok: false, error: "jev_empty_response" };
    }

    return { ok: true, raw };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "jev_timeout" };
    }
    const message = error instanceof Error ? error.message : "unknown_error";
    return { ok: false, error: "jev_transport_error", detail: message };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Extrai o objeto JSON da resposta do JEV. O LLM pode cercar o JSON com
 * cercas de código; o JSON pode estar em qualquer posição do texto.
 */
export function extractJevJson(raw: string): unknown {
  const trimmed = raw.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates: string[] = [];
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  candidates.push(trimmed);

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      continue;
    }
  }

  throw new JevTransportError("jev_invalid_json");
}

export type JevRawReport = AdvisorReport;

/**
 * Orquestra chamada + extração. A validação do relatório é feita pela
 * camada de validação (advisor/validate.ts) — este módulo não decide nada.
 */
export async function analyzeWithJev(
  config: JevClientConfig,
  state: AdvisorState,
  questions: AdvisorQuestions
): Promise<{ raw: string; parsed: unknown } | { error: string; detail?: string }> {
  const call = await callJev(config, state, questions);
  if (!call.ok) {
    return { error: call.error, detail: call.detail };
  }
  try {
    const parsed = extractJevJson(call.raw);
    return { raw: call.raw, parsed };
  } catch {
    return { error: "jev_invalid_json" };
  }
}

export type { AdvisorReport };

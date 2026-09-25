import { NextResponse } from "next/server";
import { createRequestObservability, observeApiResult } from "@/lib/observability/request-context";
import { advisorAnalyzeRequestSchema } from "@/lib/advisor/types";
import { buildAdvisorQuestions, buildAdvisorState } from "@/lib/advisor/questions";
import { analyzeWithJev } from "@/lib/advisor/jev-client";
import { validateJevReport } from "@/lib/advisor/validate";
import { toAdvisorViewModel } from "@/lib/advisor/view-model";
import type { AdvisorQuestions, AdvisorReport, AdvisorState } from "@/lib/advisor/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/advisor/analyze
//
// Fluxo obrigatório:
//   1. montar STATE (a partir do perfil enviado)
//   2. montar QUESTIONS
//   3. chamar o JEV (chamada real — LLM server-side)
//   4. validar a resposta do JEV (fail-closed)
//   5. transformar em dados para a interface
//
// A aplicação NÃO decide previamente qual empresa/solução é melhor.
// ---------------------------------------------------------------------------

export type AdvisorConfig = {
  endpoint: string;
  apiKey: string;
  model?: string;
};

export function loadAdvisorConfig(env: NodeJS.ProcessEnv = process.env): AdvisorConfig | null {
  const endpoint = env.JEV_ENDPOINT?.trim();
  const apiKey = env.JEV_API_KEY?.trim();
  if (!endpoint || !apiKey) return null;
  const model = env.JEV_MODEL?.trim();
  return { endpoint, apiKey, ...(model ? { model } : {}) };
}

export async function POST(request: Request) {
  const obs = createRequestObservability(request, "advisor.analyze");

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = advisorAnalyzeRequestSchema.safeParse(json);
  if (!parsed.success) {
    observeApiResult(obs, "client_error", { error: "invalid_state" });
    return obs.withHeaders(
      NextResponse.json(
        { ok: false, error: "invalid_state", details: parsed.error.flatten() },
        { status: 400 }
      )
    );
  }

  const config = loadAdvisorConfig();
  if (!config) {
    observeApiResult(obs, "server_error", { error: "jev_not_configured" });
    return obs.withHeaders(
      NextResponse.json({ ok: false, error: "jev_not_configured" }, { status: 503 })
    );
  }

  // 1. STATE  2. QUESTIONS
  const state: AdvisorState = buildAdvisorState(parsed.data.state);
  const questions: AdvisorQuestions = buildAdvisorQuestions();

  // 3. JEV (chamada real)
  const analysis = await analyzeWithJev(config, state, questions);
  if ("error" in analysis) {
    observeApiResult(obs, "server_error", { error: analysis.error });
    return obs.withHeaders(
      NextResponse.json(
        { ok: false, error: analysis.error, ...(analysis.detail ? { detail: analysis.detail } : {}) },
        { status: 502 }
      )
    );
  }

  // 4. Validação (fail-closed — sem fabricar substituto)
  const validation = validateJevReport(analysis.parsed, state);
  if (!validation.ok) {
    observeApiResult(obs, "server_error", { error: validation.error });
    return obs.withHeaders(
      NextResponse.json({ ok: false, error: validation.error }, { status: 502 })
    );
  }

  // 5. Dados para a interface
  const report: AdvisorReport = validation.report;
  const viewModel = toAdvisorViewModel(report);

  observeApiResult(obs, "ok");
  return obs.withHeaders(NextResponse.json({ ok: true, report, viewModel }));
}

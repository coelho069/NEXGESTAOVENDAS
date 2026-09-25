import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdvisorReport, AdvisorState } from "@/lib/advisor/types";
import { ADVISOR_QUESTIONS_V1 } from "@/lib/advisor/types";
import { buildAdvisorPrompt } from "@/lib/advisor/prompt";
import { analyzeWithJev, callJev, extractJevJson } from "@/lib/advisor/jev-client";
import { DECISION_TERMS, validateJevReport } from "@/lib/advisor/validate";
import { toAdvisorViewModel } from "@/lib/advisor/view-model";

// ---------------------------------------------------------------------------
// Requisitos de teste:
//  1. JEV é chamado (de verdade, via transport — mockado no teste de unidade).
//  2. STATE é enviado.
//  3. QUESTIONS são enviadas.
//  4. Resposta do JEV é validada.
//  5. Preços não são inventados.
//  6. Dados não verificados são marcados.
//  7. Divergências entre fontes são preservadas.
//  8. A interface não cria automaticamente "melhor opção".
//  9. Nenhum dado falso é criado para completar a tabela.
// ---------------------------------------------------------------------------

const STATE: AdvisorState = {
  sector: "varejo",
  businessSize: "pequeno porte",
  monthlyRevenue: 30000,
  cashRegisters: 1,
  fiscalRequirement: "NF-e completa",
  budget: 0,
  requiredFeatures: ["PDV", "estoque", "financeiro", "NF-e"],
};

function buildValidReport(overrides: Partial<AdvisorReport> = {}): AdvisorReport {
  return {
    profile: { ...STATE },
    requirements: [
      { requirement: "PDV", kind: "obrigatorio" },
      { requirement: "estoque", kind: "obrigatorio" },
      { requirement: "financeiro", kind: "desejavel" },
      { requirement: "NF-e", kind: "obrigatorio" },
    ],
    comparisons: [
      {
        candidate: "Gestão Mais Simples",
        requirements: [
          { requirement: "PDV", status: "atende", evidence: "Página oficial descreve módulo PDV." },
          { requirement: "estoque", status: "atende", evidence: "Página oficial descreve controle de estoque." },
          { requirement: "financeiro", status: "atende", evidence: "Página oficial descreve financeiro." },
          { requirement: "NF-e", status: "atende", evidence: "Documentação oficial lista emissão de NF-e." },
        ],
        cost: "R$ 0",
        additionalCosts: [],
        advantages: ["Custo inicial zero"],
        limitations: ["Menos recursos avançados de varejo."],
        evidence: [{ label: "Site oficial", url: "https://exemplo.com", retrievedAt: "2026-09" }],
      },
      {
        candidate: "MarketUP",
        requirements: [
          { requirement: "PDV", status: "nao_atende", evidence: "Plano inicial excede orçamento informado (R$ 0)." },
          { requirement: "estoque", status: "atende", evidence: "Página oficial descreve estoque." },
          { requirement: "financeiro", status: "parcialmente", evidence: "Módulo financeiro em plano superior." },
          { requirement: "NF-e", status: "atende", evidence: "Documentação oficial lista NF-e." },
        ],
        cost: "R$ 99/mês",
        additionalCosts: ["Certificado digital (quando aplicável)"],
        advantages: ["Recursos avançados de varejo"],
        limitations: ["Custo mensal acima do orçamento informado."],
        evidence: [{ label: "Página de planos", url: "https://exemplo.com/planos", retrievedAt: "2026-09" }],
      },
    ],
    warnings: [],
    unverifiedInformation: ["Integração bancária de MarketUP não verificada."],
    additionalCosts: ["Certificado digital", "Implantação"],
    nextSteps: ["Confirmar preços atuais na página oficial de cada solução."],
    divergences: [],
    ...overrides,
  };
}

const CONFIG = { endpoint: "https://jev.example.com/analyze", apiKey: "test-key" };

function mockFetchOnce(payload: unknown, init?: { ok?: boolean; status?: number }) {
  const response = {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
  };
  return vi.fn().mockResolvedValueOnce(response);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QUESTIONS canônicas", () => {
  it("contém as 11 perguntas definidas", () => {
    expect(ADVISOR_QUESTIONS_V1.version).toBe(1);
    expect(ADVISOR_QUESTIONS_V1.items).toHaveLength(11);
    expect(ADVISOR_QUESTIONS_V1.items.map((item) => item.id)).toEqual([
      "q01",
      "q02",
      "q03",
      "q04",
      "q05",
      "q06",
      "q07",
      "q08",
      "q09",
      "q10",
      "q11",
    ]);
  });

  it("prompt do JEV inclui STATE e as 11 QUESTIONS e a proibição de decisão", () => {
    const prompt = buildAdvisorPrompt(STATE, ADVISOR_QUESTIONS_V1);
    expect(prompt).toContain(JSON.stringify(STATE, null, 2));
    for (const item of ADVISOR_QUESTIONS_V1.items) {
      expect(prompt).toContain(`[${item.id}] ${item.question}`);
    }
    expect(prompt.toLowerCase()).toContain("proibido");
    expect(prompt).toContain("Veredito");
  });
});

describe("1–3. chamada real do JEV com STATE e QUESTIONS", () => {
  it("faz POST com prompt contendo STATE e QUESTIONS e retorna a resposta bruta", async () => {
    const report = buildValidReport();
    const fetchMock = mockFetchOnce("```json\n" + JSON.stringify(report) + "\n```");
    vi.stubGlobal("fetch", fetchMock);

    const result = await callJev(CONFIG, STATE, ADVISOR_QUESTIONS_V1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(CONFIG.endpoint);
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as { prompt: string };
    expect(body.prompt).toContain(JSON.stringify(STATE, null, 2));
    expect(body.prompt).toContain("[q01] Quais são os requisitos obrigatórios?");
    expect(body.prompt).toContain("[q11] Quais informações precisam ser verificadas antes de contratar?");
    expect(result.ok).toBe(true);
  });

  it("propaga falha de transporte sem simular resposta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" })
    );
    const result = await callJev(CONFIG, STATE, ADVISOR_QUESTIONS_V1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("jev_http_500");
  });

  it("analyzeWithJev extrai o JSON mesmo com cercas de código", async () => {
    const report = buildValidReport();
    vi.stubGlobal(
      "fetch",
      mockFetchOnce("Aqui está a análise:\n```json\n" + JSON.stringify(report) + "\n```\nObrigado.")
    );

    const result = await analyzeWithJev(CONFIG, STATE, ADVISOR_QUESTIONS_V1);
    expect("raw" in result).toBe(true);
    if ("raw" in result) {
      expect(extractJevJson(result.raw)).toEqual(report);
    }
  });
});

describe("4. resposta do JEV é validada (fail-closed)", () => {
  it("aceita relatório válido e ecoa o STATE como profile", () => {
    const result = validateJevReport(buildValidReport(), STATE);
    expect(result.ok).toBe(true);
  });

  it("rejeita relatório com schema inválida", () => {
    const broken = buildValidReport({ comparisons: [] });
    const result = validateJevReport(broken, STATE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("jev_report_schema_violation");
  });

  it("rejeita quando o profile não é o STATE enviado", () => {
    const report = buildValidReport({ profile: { ...STATE, budget: 999 } });
    const result = validateJevReport(report, STATE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("jev_profile_mismatch");
  });

  it.each(DECISION_TERMS)("rejeita decisão automática do JEV (%s)", (term) => {
    const report = buildValidReport({
      warnings: [`Análise concluída: ${term} é a Gestão Mais Simples.`],
    });
    const result = validateJevReport(report, STATE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("jev_decision_ban_violation");
  });
});

describe("5. preços não são inventados", () => {
  it("normaliza custo ausente para 'Não informado' e nunca preenche com valor", () => {
    const report = buildValidReport({
      comparisons: [
        {
          candidate: "Solução X",
          requirements: [
            { requirement: "PDV", status: "nao_verificado", evidence: "" },
          ],
          cost: "",
          additionalCosts: [],
          advantages: [],
          limitations: [],
          evidence: [],
        },
      ],
    });
    const result = validateJevReport(report, STATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.comparisons[0]?.cost).toBe("Não informado");
    }
  });

  it("mantém faixa e preço confirmado com fonte", () => {
    const report = buildValidReport();
    report.comparisons[1]!.cost = "R$ 79–129";
    const result = validateJevReport(report, STATE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.report.comparisons[1]?.cost).toBe("R$ 79–129");
  });

  it("não afirma recurso fiscal sem evidência (fica 'não verificado')", () => {
    const report = buildValidReport();
    report.comparisons[0]!.requirements = [
      { requirement: "NF-e", status: "nao_verificado", evidence: "" },
      { requirement: "PDV", status: "atende", evidence: "Página oficial descreve módulo PDV." },
      { requirement: "estoque", status: "atende", evidence: "Página oficial descreve estoque." },
      { requirement: "financeiro", status: "atende", evidence: "Página oficial descreve financeiro." },
    ];
    const result = validateJevReport(report, STATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const nfe = result.report.comparisons[0]?.requirements.find(
        (requirement) => requirement.requirement === "NF-e"
      );
      expect(nfe?.status).toBe("nao_verificado");
      expect(nfe?.evidence).toBe("Não verificado");
    }
  });
});

describe("6–7. não verificado e divergências preservadas", () => {
  it("propaga unverifiedInformation sem filtrar conteúdo", () => {
    const unverified = ["Preço da Solução X não verificado.", "Homologação SEFAZ sem evidência."];
    const report = buildValidReport({ unverifiedInformation: unverified });
    const result = validateJevReport(report, STATE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.report.unverifiedInformation).toEqual(unverified);
  });

  it("preserva divergência entre fontes com status 'necessita verificação'", () => {
    const report = buildValidReport({
      divergences: [
        {
          topic: "Preço mensal de MarketUP",
          sourceA: "Página de planos oficial: R$ 99/mês",
          sourceB: "Revenda parceira: R$ 79/mês",
          date: "2026-08",
          status: "necessita verificação",
        },
      ],
    });
    const result = validateJevReport(report, STATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.divergences).toHaveLength(1);
      expect(result.report.divergences[0]?.status).toBe("necessita verificação");
    }
  });

  it("view model mantém divergência sem escolher uma versão", () => {
    const report = buildValidReport({
      divergences: [
        {
          topic: "Preço mensal de MarketUP",
          sourceA: "Fonte A: R$ 99/mês",
          sourceB: "Fonte B: R$ 79/mês",
          date: "2026-08",
          status: "necessita verificação",
        },
      ],
    });
    const viewModel = toAdvisorViewModel(buildValidReport({ divergences: report.divergences }));
    expect(viewModel.divergences[0]).toMatchObject({
      sourceA: "Fonte A: R$ 99/mês",
      sourceB: "Fonte B: R$ 79/mês",
      status: "necessita verificação",
    });
    expect(JSON.stringify(viewModel)).not.toContain("escolhido");
  });
});

describe("8–9. interface sem decisão automática e sem dados falsos", () => {
  it("view model não contém termos de decisão e não cria seções proibidas", () => {
    const viewModel = toAdvisorViewModel(buildValidReport());
    const serialized = JSON.stringify(viewModel).toLowerCase();
    for (const term of DECISION_TERMS) {
      expect(serialized).not.toContain(term);
    }
    expect(viewModel).not.toHaveProperty("verdict");
    expect(viewModel).not.toHaveProperty("winner");
    expect(viewModel).not.toHaveProperty("bestOption");
    expect(viewModel).not.toHaveProperty("planA");
    expect(viewModel).not.toHaveProperty("planB");
    expect(viewModel).not.toHaveProperty("recommendation");
  });

  it("comparação não ganha candidatos ou requisitos inventados", () => {
    const report = buildValidReport();
    const viewModel = toAdvisorViewModel(report);
    expect(viewModel.comparisons).toHaveLength(report.comparisons.length);
    viewModel.comparisons.forEach((comparison, index) => {
      const source = report.comparisons[index]!;
      expect(comparison.candidate).toBe(source.candidate);
      expect(comparison.requirements).toHaveLength(source.requirements.length);
    });
  });

  it("evidência vazia não é preenchida com dado falso", () => {
    const report = buildValidReport();
    report.comparisons[0]!.requirements[0]!.evidence = "";
    const result = validateJevReport(report, STATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.comparisons[0]?.requirements[0]?.evidence).toBe("Não verificado");
    }
  });
});

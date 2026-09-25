import { z } from "zod";

// ---------------------------------------------------------------------------
// PDV Advisor — contratos do motor de análise (JEV)
//
// JEV  = motor de análise e decisão estruturada (chamado de verdade via API).
// NEX  = sistema que APRESENTA a análise (nunca decide).
// USUÁRIO = quem decide.
//
// Regra estrutural: nenhuma parte deste módulo produz "veredito", ranking,
// vencedor ou recomendação. Toda síntese vem do JEV; a aplicação apenas
// valida e apresenta.
// ---------------------------------------------------------------------------

export const advisorRequirementStatusSchema = z.enum([
  "atende",
  "nao_atende",
  "parcialmente",
  "nao_verificado",
]);

export type AdvisorRequirementStatus = z.infer<typeof advisorRequirementStatusSchema>;

// ---------------------------------------------------------------------------
// STATE — perfil do negócio (montado pela aplicação, enviado ao JEV)
// ---------------------------------------------------------------------------

export const advisorStateSchema = z.object({
  sector: z.string().trim().min(1).max(120),
  businessSize: z.string().trim().min(1).max(120),
  monthlyRevenue: z.number().finite().min(0).max(1_000_000_000),
  cashRegisters: z.number().int().min(0).max(10_000),
  fiscalRequirement: z.string().trim().min(1).max(200),
  budget: z.number().finite().min(0).max(1_000_000_000),
  requiredFeatures: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
});

export type AdvisorState = z.infer<typeof advisorStateSchema>;

// ---------------------------------------------------------------------------
// QUESTIONS — as perguntas que o JEV deve responder para cada candidato
// ---------------------------------------------------------------------------

export const advisorQuestionsSchema = z
  .object({
    version: z.literal(1),
    items: z.array(
      z.object({
        id: z.string().trim().min(1).max(80),
        question: z.string().trim().min(1).max(500),
      })
    ),
  })
  .refine(
    (value) => new Set(value.items.map((item) => item.id)).size === value.items.length,
    "question ids must be unique"
  );

export type AdvisorQuestions = z.infer<typeof advisorQuestionsSchema>;

// ---------------------------------------------------------------------------
// Resposta do JEV
// ---------------------------------------------------------------------------

export const evidenceSourceSchema = z.object({
  label: z.string().trim().min(1).max(200),
  url: z.string().trim().max(500).optional(),
  retrievedAt: z.string().trim().max(40).optional(),
});

export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;

export const advisorRequirementAssessmentSchema = z.object({
  requirement: z.string().trim().min(1).max(200),
  status: advisorRequirementStatusSchema,
  evidence: z.string().trim().max(2000),
});

export type AdvisorRequirementAssessment = z.infer<typeof advisorRequirementAssessmentSchema>;

export const advisorCandidateSchema = z.object({
  candidate: z.string().trim().min(1).max(200),
  requirements: z.array(advisorRequirementAssessmentSchema).min(1).max(50),
  // Nunca inventar preços: "" ou "Não informado" quando não houver preço
  // confirmado; "R$ X–Y" para faixas; "R$ X/mês" para preço confirmado.
  cost: z.string().trim().max(200),
  additionalCosts: z.array(z.string().trim().min(1).max(300)).max(20),
  advantages: z.array(z.string().trim().min(1).max(500)).max(20),
  limitations: z.array(z.string().trim().min(1).max(500)).max(20),
  evidence: z.array(evidenceSourceSchema).max(20),
});

export type AdvisorCandidate = z.infer<typeof advisorCandidateSchema>;

export const advisorDivergenceSchema = z.object({
  topic: z.string().trim().min(1).max(300),
  sourceA: z.string().trim().min(1).max(1000),
  sourceB: z.string().trim().min(1).max(1000),
  date: z.string().trim().max(40),
  status: z.literal("necessita verificação"),
});

export type AdvisorDivergence = z.infer<typeof advisorDivergenceSchema>;

export const advisorReportSchema = z.object({
  profile: advisorStateSchema,
  requirements: z.array(
    z.object({
      requirement: z.string().trim().min(1).max(200),
      kind: z.enum(["obrigatorio", "desejavel"]),
    })
  ),
  comparisons: z.array(advisorCandidateSchema).min(1).max(20),
  warnings: z.array(z.string().trim().min(1).max(1000)).max(50),
  unverifiedInformation: z.array(z.string().trim().min(1).max(500)).max(50),
  additionalCosts: z.array(z.string().trim().min(1).max(300)).max(50),
  nextSteps: z.array(z.string().trim().min(1).max(500)).max(50),
  divergences: z.array(advisorDivergenceSchema).max(20),
});

export type AdvisorReport = z.infer<typeof advisorReportSchema>;

// ---------------------------------------------------------------------------
// QUESTIONS canônicas (v1) — enviadas ao JEV junto com o STATE
// ---------------------------------------------------------------------------

export const ADVISOR_QUESTIONS_V1: AdvisorQuestions = {
  version: 1,
  items: [
    { id: "q01", question: "Quais são os requisitos obrigatórios?" },
    { id: "q02", question: "Quais são os requisitos desejáveis?" },
    { id: "q03", question: "Quais soluções atendem cada requisito?" },
    { id: "q04", question: "Quais soluções não atendem cada requisito?" },
    { id: "q05", question: "Quais informações estão comprovadas?" },
    { id: "q06", question: "Quais informações não estão verificadas?" },
    { id: "q07", question: "Qual é o custo informado de cada solução?" },
    { id: "q08", question: "Existem custos adicionais?" },
    { id: "q09", question: "Existem limitações?" },
    { id: "q10", question: "Existem riscos ou dependências?" },
    { id: "q11", question: "Quais informações precisam ser verificadas antes de contratar?" },
  ],
};

// ---------------------------------------------------------------------------
// Payload/Resposta da API
// ---------------------------------------------------------------------------

export const advisorAnalyzeRequestSchema = z.object({
  state: advisorStateSchema,
});

export type AdvisorAnalyzeRequest = z.infer<typeof advisorAnalyzeRequestSchema>;

export type AdvisorAnalyzeResponse =
  | { ok: true; report: AdvisorReport }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Proibição estrutural — garantida por teste:
// nenhum campo do relatório pode carregar decisão automática.
// Campos proibidos em qualquer nível do relatório:
//   veredito, melhorOpcao, piorOpcao, vencedor, planoA, planoB, recomendado.
// ---------------------------------------------------------------------------

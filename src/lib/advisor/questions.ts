import type { AdvisorQuestions, AdvisorState } from "@/lib/advisor/types";
import { ADVISOR_QUESTIONS_V1 } from "@/lib/advisor/types";

// ---------------------------------------------------------------------------
// Montagem do STATE e das QUESTIONS enviadas ao JEV.
//
// A aplicação NÃO decide nada aqui: apenas estrutura os dados de perfil
// (STATE) e as perguntas canônicas (QUESTIONS) que o JEV deve responder.
// ---------------------------------------------------------------------------

export function buildAdvisorState(profile: AdvisorState): AdvisorState {
  return {
    sector: profile.sector.trim(),
    businessSize: profile.businessSize.trim(),
    monthlyRevenue: profile.monthlyRevenue,
    cashRegisters: profile.cashRegisters,
    fiscalRequirement: profile.fiscalRequirement.trim(),
    budget: profile.budget,
    requiredFeatures: profile.requiredFeatures.map((feature) => feature.trim()),
  };
}

export function buildAdvisorQuestions(questions: AdvisorQuestions = ADVISOR_QUESTIONS_V1): AdvisorQuestions {
  return {
    version: questions.version,
    items: questions.items.map((item) => ({
      id: item.id,
      question: item.question,
    })),
  };
}

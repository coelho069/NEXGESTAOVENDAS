import type {
  AdvisorCandidate,
  AdvisorDivergence,
  AdvisorReport,
  AdvisorState,
} from "@/lib/advisor/types";
import { advisorReportSchema } from "@/lib/advisor/types";

// ---------------------------------------------------------------------------
// Validação da resposta do JEV.
//
// Esta camada NÃO analisa e NÃO decide. Apenas:
//   1. valida a estrutura contra o schema Zod;
//   2. rejeita relatório que contenha decisão automática do JEV
//      ("Veredito", "Melhor opção", "Pior opção", "Vencedor",
//       "Plano A", "Plano B", "Recomendamos") em campos de conteúdo;
//   3. normaliza preços ausentes para "Não informado" (nunca inventa valor);
//   4. preserva divergências entre fontes (nunca escolhe uma versão);
//   5. preserva marcações "nao_verificado" (nunca converte em conclusão).
// ---------------------------------------------------------------------------

export const DECISION_TERMS = [
  "veredito",
  "melhor opção",
  "melhor opcao",
  "pior opção",
  "pior opcao",
  "vencedor",
  "plano a",
  "plano b",
  "recomendamos",
] as const;

/** Campos onde os termos de decisão são proibidos. */
function violatesDecisionBan(report: AdvisorReport): string | null {
  const candidates = report.comparisons ?? [];
  for (const candidate of candidates) {
    for (const requirement of candidate.requirements) {
      for (const term of DECISION_TERMS) {
        if (requirement.evidence.toLowerCase().includes(term)) {
          return `comparisons.requirements.evidence: "${term}"`;
        }
      }
    }
    for (const text of [...candidate.advantages, ...candidate.limitations]) {
      for (const term of DECISION_TERMS) {
        if (text.toLowerCase().includes(term)) {
          return `comparisons.advantages/limitations: "${term}"`;
        }
      }
    }
  }
  for (const warning of report.warnings ?? []) {
    for (const term of DECISION_TERMS) {
      if (warning.toLowerCase().includes(term)) {
        return `warnings: "${term}"`;
      }
    }
  }
  return null;
}

const NOT_INFORMED = "Não informado";

function normalizeCost(cost: string): string {
  const trimmed = cost.trim();
  if (!trimmed || /^não informad[ao]$/i.test(trimmed) || /^nao informad[ao]$/i.test(trimmed)) {
    return NOT_INFORMED;
  }
  return trimmed;
}

function normalizeCandidate(candidate: AdvisorCandidate): AdvisorCandidate {
  return {
    ...candidate,
    requirements: candidate.requirements.map((requirement) => ({
      ...requirement,
      // Evidência vazia nunca é preenchida com dado inventado.
      evidence: requirement.evidence.trim() || "Não verificado",
    })),
    cost: normalizeCost(costOf(candidate)),
    additionalCosts: candidate.additionalCosts.map((item) => item.trim()).filter(Boolean),
    advantages: candidate.advantages.map((item) => item.trim()).filter(Boolean),
    limitations: candidate.limitations.map((item) => item.trim()).filter(Boolean),
    evidence: candidate.evidence.filter((item) => item.label.trim().length > 0),
  };
}

function costOf(candidate: AdvisorCandidate): string {
  return candidate.cost ?? "";
}

function normalizeReport(report: AdvisorReport): AdvisorReport {
  return {
    ...report,
    comparisons: report.comparisons.map(normalizeCandidate),
    warnings: report.warnings.map((item) => item.trim()).filter(Boolean),
    unverifiedInformation: report.unverifiedInformation.map((item) => item.trim()).filter(Boolean),
    additionalCosts: report.additionalCosts.map((item) => item.trim()).filter(Boolean),
    nextSteps: report.nextSteps.map((item) => item.trim()).filter(Boolean),
  };
}

export type AdvisorValidationResult =
  | { ok: true; report: AdvisorReport }
  | { ok: false; error: string; issues?: unknown };

/**
 * Valida a resposta do JEV. Em caso de falha estrutural ou violação da
 * proibição de decisão automática, o relatório é rejeitado (fail-closed):
 * a aplicação NUNCA fabrica um substituto.
 */
export function validateJevReport(
  parsed: unknown,
  state: AdvisorState
): AdvisorValidationResult {
  const schemaResult = advisorReportSchema.safeParse(parsed);
  if (!schemaResult.success) {
    return {
      ok: false,
      error: "jev_report_schema_violation",
      issues: schemaResult.error.flatten(),
    };
  }

  const report: AdvisorReport = schemaResult.data;

  // O profile do relatório deve ser o STATE enviado — o JEV não altera o perfil.
  const profileMatchesState =
    report.profile.sector === state.sector &&
    report.profile.businessSize === state.businessSize &&
    report.profile.monthlyRevenue === state.monthlyRevenue &&
    report.profile.cashRegisters === state.cashRegisters &&
    report.profile.fiscalRequirement === state.fiscalRequirement &&
    report.profile.budget === state.budget &&
    report.profile.requiredFeatures.length === state.requiredFeatures.length &&
    report.profile.requiredFeatures.every(
      (feature, index) => feature === state.requiredFeatures[index]
    );

  if (!profileMatchesState) {
    return { ok: false, error: "jev_profile_mismatch" };
  }

  const violation = violatesDecisionBan(report);
  if (violation) {
    return { ok: false, error: "jev_decision_ban_violation", issues: violation };
  }

  return { ok: true, report: normalizeReport(report) };
}

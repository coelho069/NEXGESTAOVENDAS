import type { AdvisorDivergence } from "@/lib/advisor/types";

// ---------------------------------------------------------------------------
// Camada de apresentação — transforma o relatório validado do JEV em dados
// para a interface. NÃO cria "melhor opção", ranking ou recomendação.
// ---------------------------------------------------------------------------

export type AdvisorRequirementRow = {
  requirement: string;
  status: "atende" | "não atende" | "parcialmente" | "não verificado";
  evidence: string;
};

export type AdvisorComparisonRow = {
  candidate: string;
  requirements: AdvisorRequirementRow[];
  cost: string;
  additionalCosts: string[];
  advantages: string[];
  limitations: string[];
  evidence: { label: string; url?: string; retrievedAt?: string }[];
};

export type AdvisorDivergenceRow = {
  topic: string;
  sourceA: string;
  sourceB: string;
  date: string;
  status: "necessita verificação";
};

export type AdvisorViewModel = {
  profile: {
    sector: string;
    businessSize: string;
    monthlyRevenue: string;
    cashRegisters: string;
    fiscalRequirement: string;
    budget: string;
    requiredFeatures: string[];
  };
  requirements: { requirement: string; kind: "obrigatório" | "desejável" }[];
  comparisons: AdvisorComparisonRow[];
  warnings: string[];
  additionalCosts: string[];
  limitations: string[];
  evidence: { candidate: string; sources: { label: string; url?: string; retrievedAt?: string }[] }[];
  unverifiedInformation: string[];
  divergences: AdvisorDivergenceRow[];
  nextSteps: string[];
};

const STATUS_LABELS: Record<string, AdvisorRequirementRow["status"]> = {
  atende: "atende",
  nao_atende: "não atende",
  parcialmente: "parcialmente",
  nao_verificado: "não verificado",
};

const KIND_LABELS: Record<string, "obrigatório" | "desejável"> = {
  obrigatorio: "obrigatório",
  desejavel: "desejável",
};

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);
}

export function toAdvisorViewModel(report: AdvisorReportLike): AdvisorViewModel {
  return {
    profile: {
      sector: report.profile.sector,
      businessSize: report.profile.businessSize,
      monthlyRevenue: formatBRL(report.profile.monthlyRevenue),
      cashRegisters: String(report.profile.cashRegisters),
      fiscalRequirement: report.profile.fiscalRequirement,
      budget: formatBRL(report.profile.budget),
      requiredFeatures: report.profile.requiredFeatures,
    },
    requirements: report.requirements.map((requirement) => ({
      requirement: requirement.requirement,
      kind: KIND_LABELS[requirement.kind] ?? requirement.kind,
    })),
    comparisons: report.comparisons.map((comparison) => ({
      candidate: comparison.candidate,
      requirements: comparison.requirements.map((requirement) => ({
        requirement: requirement.requirement,
        status: STATUS_LABELS[requirement.status] ?? requirement.status,
        evidence: requirement.evidence,
      })),
      cost: comparison.cost,
      additionalCosts: comparison.additionalCosts,
      advantages: comparison.advantages,
      limitations: comparison.limitations,
      evidence: comparison.evidence,
    })),
    warnings: report.warnings,
    additionalCosts: report.additionalCosts,
    limitations: report.comparisons.flatMap((comparison) =>
      comparison.limitations.map((limitation) => `${comparison.candidate}: ${limitation}`)
    ),
    evidence: report.comparisons.map((comparison) => ({
      candidate: comparison.candidate,
      sources: comparison.evidence,
    })),
    unverifiedInformation: report.unverifiedInformation,
    divergences: report.divergences.map(toDivergenceRow),
    nextSteps: report.nextSteps,
  };
}

function toDivergenceRow(divergence: {
  topic: string;
  sourceA: string;
  sourceB: string;
  date: string;
  status: string;
}): AdvisorDivergenceRow {
  return {
    topic: divergence.topic,
    sourceA: divergence.sourceA,
    sourceB: divergence.sourceB,
    date: divergence.date,
    status: "necessita verificação",
  };
}

type AdvisorReportLike = {
  profile: {
    sector: string;
    businessSize: string;
    monthlyRevenue: number;
    cashRegisters: number;
    fiscalRequirement: string;
    budget: number;
    requiredFeatures: string[];
  };
  requirements: { requirement: string; kind: string }[];
  comparisons: {
    candidate: string;
    requirements: { requirement: string; status: string; evidence: string }[];
    cost: string;
    additionalCosts: string[];
    advantages: string[];
    limitations: string[];
    evidence: { label: string; url?: string; retrievedAt?: string }[];
  }[];
  warnings: string[];
  unverifiedInformation: string[];
  additionalCosts: string[];
  nextSteps: string[];
  divergences: {
    topic: string;
    sourceA: string;
    sourceB: string;
    date: string;
    status: string;
  }[];
};

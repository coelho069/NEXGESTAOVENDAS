import type { AdvisorQuestions, AdvisorState } from "@/lib/advisor/types";

// ---------------------------------------------------------------------------
// Prompt do JEV — motor de análise e decisão estruturada.
//
// O JEV é chamado de verdade (LLM via API server-side). Ele responde as
// QUESTIONS a partir do STATE e retorna dados estruturados com evidências.
//
// Proibições inegociáveis do prompt (reforçadas por teste):
//   - "Veredito", "Melhor opção", "Pior opção", "Vencedor",
//     "Plano A", "Plano B", "Recomendamos X".
// O JEV apresenta critérios, evidências, compatibilidade e limitações.
// A decisão final é do usuário.
// ---------------------------------------------------------------------------

const FORBIDDEN_OUTPUT_RULE = [
  "PROIBIDO produzir qualquer um destes campos ou seções:",
  '"Veredito", "Melhor opção", "Pior opção", "Vencedor", "Plano A", "Plano B", "Recomendamos X".',
  "Não rankie candidatos. Não escolha um vencedor. Não recomende.",
  "Apresente apenas critérios, evidências, compatibilidade e limitações,",
  "para que o USUÁRIO tome a decisão.",
].join(" ");

const EVIDENCE_RULES = [
  "REGRAS DE EVIDÊNCIA:",
  '1. Nunca invente preços. Sem preço confirmado use exatamente \\"Não informado\".',
  'Com faixa confirmada use \\"R$ X–Y\". Com preço confirmado use \\"R$ X/mês\". Sempre mantenha a fonte.',
  "2. Não afirme NF-e, NFC-e, certificado digital, homologação ou integração SEFAZ sem evidência.",
  'Sem evidência, status do requisito = \\"nao_verificado\" e evidência = \\"Não verificado\".',
  '3. Se uma fonte contradizer outra, NÃO escolha silenciosamente uma versão:',
  'registre em "divergences" com topic, sourceA, sourceB, date e status = "necessita verificação".',
  "4. Considere a data das informações. NUNCA trate informação antiga como atual;",
  "informação desatualizada ou sem data deve ir para \"unverifiedInformation\".",
  "5. Separe custos adicionais por categoria: mensalidade, certificado digital, emissor fiscal,",
  "TEF, NFC-e, suporte, implantação, hardware, outros. Não classifique um custo como",
  '"inevitável" sem evidência suficiente.',
  "6. Nenhum dado falso para completar tabela. O que não estiver comprovado vai para",
  '"unverifiedInformation" ou status "nao_verificado".',
].join("\n");

const OUTPUT_CONTRACT = [
  "FORMATO DE SAÍDA (JSON estrito, sem texto fora do JSON):",
  "{",
  '  "profile": { ...state recebido, ecoado sem alteração... },',
  '  "requirements": [ { "requirement": string, "kind": "obrigatorio" | "desejavel" } ],',
  '  "comparisons": [ {',
  '    "candidate": string,',
  '    "requirements": [ { "requirement": string, "status": "atende" | "nao_atende" | "parcialmente" | "nao_verificado", "evidence": string } ],',
  '    "cost": string,',
  '    "additionalCosts": string[],',
  '    "advantages": string[],',
  '    "limitations": string[],',
  '    "evidence": [ { "label": string, "url"?: string, "retrievedAt"?: string } ]',
  "  } ],",
  '  "warnings": string[],',
  '  "unverifiedInformation": string[],',
  '  "additionalCosts": string[],',
  '  "nextSteps": string[],',
  '  "divergences": [ { "topic": string, "sourceA": string, "sourceB": string, "date": string, "status": "necessita verificação" } ]',
  "}",
  "Cada candidato em comparisons deve cobrir TODOS os requisitos do STATE.",
].join("\n");

export function buildAdvisorPrompt(state: AdvisorState, questions: AdvisorQuestions): string {
  const questionLines = questions.items
    .map((item) => `- [${item.id}] ${item.question}`)
    .join("\n");

  return [
    "Você é o JEV: motor de análise e decisão estruturada do PDV Advisor.",
    "Você analisa o perfil (STATE) e responde as QUESTIONS com dados estruturados e evidências.",
    "",
    FORBIDDEN_OUTPUT_RULE,
    "",
    EVIDENCE_RULES,
    "",
    "STATE (perfil do negócio):",
    JSON.stringify(state, null, 2),
    "",
    `QUESTIONS (versão ${questions.version}) — responda todas:`,
    questionLines,
    "",
    "RESPONSABILIDADES:",
    "- JEV = motor de análise. NEX Gestão = sistema que apresenta a análise. Usuário = quem decide.",
    "",
    OUTPUT_CONTRACT,
  ].join("\n");
}

export const ADVISOR_PROMPT_FORBIDDEN_TERMS = [
  "Veredito",
  "Melhor opção",
  "Pior opção",
  "Vencedor",
  "Plano A",
  "Plano B",
  "Recomendamos",
] as const;

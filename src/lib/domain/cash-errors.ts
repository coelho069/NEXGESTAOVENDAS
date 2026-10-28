/** Map API/RPC cash error codes to operator-facing pt-BR messages. */
const CASH_ERROR_MESSAGES: Record<string, string> = {
  forbidden_cash: "Você não tem permissão para operar o caixa.",
  invalid_cash_query: "Consulta de caixa inválida. Atualize a página.",
  invalid_cash_payload: "Dados do caixa inválidos. Confira valor e motivo.",
  invalid_json: "Requisição inválida.",
  invalid_cash_operation: "Operação de caixa inválida. Confira o valor informado.",
  cash_operation_failed: "Não foi possível concluir a operação de caixa.",
  cash_session_conflict: "Já existe caixa aberto neste terminal ou há conflito de sessão. Atualize e tente de novo.",
  cash_session_closed: "Este caixa já foi fechado. Abra um novo caixa.",
  cash_session_required: "Abra o caixa deste terminal antes de continuar.",
  cash_idempotency_payload_mismatch: "Esta operação já foi enviada com outros dados. Atualize o caixa.",
};

export function cashErrorMessage(codeOrMessage: string | null | undefined): string {
  if (!codeOrMessage) return "Não foi possível concluir a operação de caixa.";
  const trimmed = codeOrMessage.trim();
  if (CASH_ERROR_MESSAGES[trimmed]) return CASH_ERROR_MESSAGES[trimmed];
  // Already human text (pt-BR from client)
  if (/[àáâãéêíóôõúç\s]/i.test(trimmed) && !trimmed.includes("_")) return trimmed;
  return CASH_ERROR_MESSAGES[trimmed] ?? trimmed;
}

export function cashMovementTypeLabel(
  type: string
): string {
  switch (type) {
    case "supply":
      return "Suprimento";
    case "withdrawal":
      return "Sangria";
    case "sale_cash":
      return "Venda (dinheiro)";
    case "refund":
      return "Estorno / reembolso";
    case "adjustment":
      return "Ajuste";
    default:
      return type;
  }
}

/** Normalize "10,50" / "10.5" → "10.50" for cash APIs. */
export function normalizeCashMoneyInput(raw: string): string | null {
  const cleaned = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!cleaned) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return null;
  return num.toFixed(2);
}

export type RpcFailureLike = {
  code?: string | null;
  message?: string | null;
  hint?: string | null;
  details?: string | null;
};

export type MappedSaleProcessError = {
  error: string;
  status: number;
};

const RPC_TEXT_LIMIT = 240;

const ACTIONABLE_TOKENS: ReadonlyArray<{ token: string; error: string; status: number }> = [
  { token: "idempotency_payload_mismatch", error: "idempotency_payload_mismatch", status: 409 },
  { token: "cash_idempotency_payload_mismatch", error: "cash_session_conflict", status: 409 },
  { token: "cash_sale_session_mismatch", error: "cash_session_conflict", status: 409 },
  { token: "cash_session_terminal_mismatch", error: "cash_session_conflict", status: 409 },
  { token: "cash_session_already_open", error: "cash_session_conflict", status: 409 },
  { token: "cash_session_closed", error: "cash_session_closed", status: 409 },
  { token: "cash_session_required", error: "cash_session_required", status: 409 },
  { token: "cash_sale_missing_payment", error: "cash_sale_missing_payment", status: 422 },
  { token: "cash_sale_missing_sale", error: "cash_sale_missing_sale", status: 422 },
  { token: "cash_sale_not_reconciled", error: "cash_sale_not_reconciled", status: 422 },
  { token: "payment_cash_session_scope_mismatch", error: "cash_session_conflict", status: 409 },
  { token: "cash_movement_session_invalid", error: "cash_session_conflict", status: 409 },
  { token: "cash_movement_sale_scope_mismatch", error: "cash_session_conflict", status: 409 },
  { token: "invalid_cash_sale_payload", error: "invalid_sale_payload", status: 422 },
  { token: "insufficient_stock", error: "insufficient_stock", status: 422 },
  { token: "negative_stock", error: "insufficient_stock", status: 422 },
  { token: "price_mismatch", error: "price_mismatch", status: 422 },
  { token: "product_not_found", error: "product_not_found", status: 422 },
  { token: "customer_not_found", error: "customer_not_found", status: 422 },
  { token: "customer_required_on_sale", error: "customer_required_on_sale", status: 422 },
  { token: "customer_document_required", error: "customer_document_required", status: 422 },
  { token: "customer_store_scope_mismatch", error: "customer_not_found", status: 422 },
  { token: "payment_total_mismatch", error: "payment_total_mismatch", status: 422 },
  { token: "invalid_card_sale", error: "invalid_sale_payload", status: 422 },
  { token: "card_payment_not_captured", error: "card_payment_not_captured", status: 422 },
  { token: "card_payment_intent_not_found", error: "card_payment_intent_not_found", status: 404 },
  { token: "store_not_found", error: "invalid_sale_payload", status: 422 },
  { token: "payment_method_not_configured", error: "payment_method_not_configured", status: 422 },
  { token: "inventory_movement_balance_mismatch", error: "inventory_movement_conflict", status: 422 },
  { token: "inventory_movement_chain_mismatch", error: "inventory_movement_conflict", status: 422 },
  { token: "discount_limit_exceeded", error: "discount_limit_exceeded", status: 403 },
  { token: "store_access_denied", error: "forbidden_store", status: 403 },
  { token: "forbidden_cash", error: "forbidden_store", status: 403 },
  { token: "access_denied", error: "forbidden_store", status: 403 },
  { token: "forbidden", error: "forbidden_store", status: 403 },
  { token: "invalid_sale_payload", error: "invalid_sale_payload", status: 422 },
  { token: "invalid_sale_item", error: "invalid_sale_payload", status: 422 },
  { token: "invalid_quantity", error: "invalid_sale_payload", status: 422 },
  { token: "empty_items", error: "invalid_sale_payload", status: 422 },
  { token: "invalid_total", error: "invalid_sale_payload", status: 422 },
  { token: "invalid_discount", error: "invalid_sale_payload", status: 422 },
  { token: "duplicate_product", error: "invalid_sale_payload", status: 422 },
  { token: "invalid_item_total", error: "invalid_sale_payload", status: 422 },
  { token: "invalid_payload", error: "invalid_sale_payload", status: 422 },
];

function truncateRpcText(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;
  return trimmed.length > RPC_TEXT_LIMIT ? `${trimmed.slice(0, RPC_TEXT_LIMIT)}…` : trimmed;
}

export function rpcFailureLogFields(error: RpcFailureLike): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const code = error.code?.trim();
  const message = truncateRpcText(error.message);
  const hint = truncateRpcText(error.hint);
  const details = truncateRpcText(error.details);
  if (code) fields.rpcCode = code;
  if (message) fields.rpcMessage = message;
  if (hint) fields.rpcHint = hint;
  if (details) fields.rpcDetails = details;
  return fields;
}

export function mapProcessSaleRpcError(error: RpcFailureLike): MappedSaleProcessError | null {
  const haystack = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  for (const candidate of ACTIONABLE_TOKENS) {
    if (haystack.includes(candidate.token)) {
      return { error: candidate.error, status: candidate.status };
    }
  }
  if (error.code === "22023" || error.code === "23514") {
    return { error: "sale_processing_failed", status: 422 };
  }
  return null;
}

const SALE_PROCESS_ERROR_MESSAGES: Record<string, string> = {
  customer_required_on_sale: "Selecione um cliente para concluir a venda.",
  customer_document_required: "O cliente selecionado precisa de CPF/CNPJ cadastrado.",
  customer_not_found: "Cliente não encontrado nesta organização.",
  inventory_movement_conflict:
    "Livro de estoque inconsistente com o saldo. Tente novamente ou ajuste o estoque.",
  insufficient_stock: "Estoque insuficiente para concluir a venda.",
  cash_session_required: "Abra o caixa deste terminal antes de vender em dinheiro.",
  cash_session_conflict: "Sessão de caixa deste terminal está em conflito. Reabra o caixa.",
  cash_session_closed: "Sessão de caixa encerrada. Abra o caixa deste terminal.",
  card_payment_not_captured: "Cartão autorizado sem captura. A venda não foi confirmada.",
  card_payment_intent_not_found: "Pagamento com cartão não encontrado para esta venda.",
  card_capture_without_sale: "Capture sem venda confirmada. Não trate como capturado; reconcilie.",
  sale_processing_failed: "Falha ao processar a venda. Tente novamente.",
};

export function describeSaleProcessError(error: string | null | undefined): string {
  if (!error) return "Falha ao processar a venda. Tente novamente.";
  return SALE_PROCESS_ERROR_MESSAGES[error] ?? error;
}

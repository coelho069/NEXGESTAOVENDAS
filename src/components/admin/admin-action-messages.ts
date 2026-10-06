export function adminActionErrorMessage(error: string | null | undefined): string {
  switch (error) {
    case "forbidden":
    case "forbidden_admin":
      return "Você não tem permissão de Platform Admin para esta operação.";
    case "validation_failed":
    case "invalid_filters":
      return "Os dados informados são inválidos. Revise os campos e tente novamente.";
    case "organization_not_found":
      return "Organização não encontrada.";
    case "subscription_not_found":
      return "Assinatura não encontrada.";
    case "subscription_cancelled":
      return "Esta assinatura já está cancelada e não pode ser alterada.";
    case "plan_not_found":
      return "Plano não encontrado.";
    case "plan_inactive":
      return "Não é possível usar um plano inativo. Ative o plano ou escolha outro.";
    case "plan_in_use":
      return "Este plano está vinculado a assinaturas. Desative-o em vez de excluir.";
    case "open_subscription_exists":
      return "Já existe uma assinatura ativa, em trial ou em atraso para esta organização.";
    case "constraint_violation":
      return "A operação viola as regras do período ou do status da assinatura.";
    case "refund_request_not_found":
      return "Pedido de reembolso não encontrado.";
    case "refund_request_terminal":
      return "Este pedido já foi encerrado e não pode mudar de status.";
    case "invalid_transition":
      return "Essa mudança de status não é permitida a partir do estado atual.";
    case "resolution_note_required":
      return "Recusar exige uma nota com pelo menos 3 caracteres.";
    case "outside_window_unacknowledged":
      return "Pedido fora do prazo: confirme a análise antes de aprovar.";
    case "refund_request_conflict":
      return "O pedido mudou enquanto você analisava. Atualize a página.";
    case "provider_refund_not_enabled":
      return "O estorno no Mercado Pago não está habilitado nesta versão.";
    case "service_role_unavailable":
      return "O servidor não conseguiu gravar o pedido. Tente novamente.";
    case "sandbox_disabled":
      return "O processamento sandbox não está ativo neste ambiente.";
    case "paid_amount_unavailable":
      return "O valor pago confirmado não está disponível.";
    case "not_owner":
    case "payment_not_owned":
      return "O pagamento não pertence ao cliente deste pedido.";
    case "not_approved":
      return "Somente um pedido aprovado pode ser processado.";
    case "provider_timeout":
      return "O resultado do sandbox é desconhecido. O reembolso não foi confirmado.";
    case "provider_unavailable":
      return "O sandbox falhou temporariamente. Você pode tentar de novo.";
    case "refund_not_allowed":
      return "O sandbox recusou o reembolso de forma definitiva.";
    case "not_retryable":
    case "retry_exhausted":
      return "Este pedido não pode ser reprocessado.";
    case "processing_in_progress":
      return "Este pedido já está em processamento.";
    case "csrf_failed":
      return "Não foi possível confirmar a origem do pedido.";
    case "unauthenticated":
      return "A sessão não está autenticada.";
    case "already_refunded":
      return "Este pedido já foi reembolsado no sandbox.";
    case "unavailable":
    default:
      return "Não foi possível concluir a operação. Tente novamente.";
  }
}

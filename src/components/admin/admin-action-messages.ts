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
    case "unavailable":
    default:
      return "Não foi possível concluir a operação. Tente novamente.";
  }
}

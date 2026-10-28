/**
 * Mensagem para a falha de `updateUser({ password })` na redefinição. Códigos do
 * Auth (e, na falta deles, status/texto) viram instrução acionável; o resto cai
 * na orientação genérica.
 */
export type PasswordResetErrorLike = {
  code?: string | null;
  status?: number | null;
  message?: string | null;
  name?: string | null;
};

const GENERIC = "Não foi possível redefinir a senha. Peça um novo link.";

export function passwordResetErrorMessage(input: string | PasswordResetErrorLike | undefined): string {
  const error: PasswordResetErrorLike = typeof input === "string" ? { code: input } : (input ?? {});
  const code = error.code ?? undefined;
  const message = (error.message ?? "").toLowerCase();

  if (code === "same_password" || message.includes("different from the old password") || message.includes("same password")) {
    return "Escolha uma senha diferente da atual.";
  }
  if (
    code === "weak_password" ||
    message.includes("password should contain") ||
    message.includes("password should be at least") ||
    message.includes("weak password") ||
    (error.status === 422 && message.includes("password"))
  ) {
    return "A senha precisa ter maiúscula, minúscula, número e símbolo.";
  }
  if (
    code === "reauthentication_needed" ||
    code === "session_not_found" ||
    code === "session_expired" ||
    code === "bad_jwt" ||
    code === "refresh_token_not_found" ||
    code === "refresh_token_already_used" ||
    code === "otp_expired" ||
    code === "no_authorization" ||
    code === "user_banned" ||
    code === "user_not_found" ||
    error.status === 401 ||
    message.includes("session missing") ||
    message.includes("invalid jwt") ||
    message.includes("expired")
  ) {
    return "Link inválido ou expirado. Peça um novo link.";
  }
  if (code === "over_request_rate_limit" || error.status === 429) {
    return "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.";
  }
  if (
    error.name === "AuthRetryableFetchError" ||
    error.status === 0 ||
    (typeof error.status === "number" && error.status >= 500 && error.status <= 530)
  ) {
    return "Falha de conexão ou do servidor. Tente de novo.";
  }
  // Sem mapeamento: mostra o código do Auth para diagnóstico (não é segredo).
  return code ? `Não foi possível redefinir a senha (código: ${code}). Peça um novo link.` : GENERIC;
}

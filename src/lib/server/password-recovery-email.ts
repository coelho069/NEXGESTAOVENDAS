import { getEmailSenderConfig, sendAccessEmail } from "@/lib/server/access-email";
import { buildPasswordRecoveryEmailContent } from "@/lib/domain/password-recovery-email";
import { createLogger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";

const logger = createLogger({ service: "nexgestaovendas", component: "password-recovery" });

const DEFAULT_SUPPORT_EMAIL = "suporte@nexgestaovendas.com.br";

/**
 * Gera o link de recuperação pelo Admin API (não envia e-mail) e entrega pelo
 * SMTP do app. Remetente: PASSWORD_RESET_EMAIL_FROM, ou EMAIL_FROM se ausente.
 * Nunca registra e-mail, link ou corpo da mensagem.
 */
export async function sendPasswordRecoveryEmail(input: {
  email: string;
  redirectTo: string;
}): Promise<{ sent: boolean }> {
  const admin = createAdminClient();
  if (!admin) {
    logger.warn("password_recovery_skipped", { reason: "admin_client_unavailable" });
    return { sent: false };
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: input.email,
    options: { redirectTo: input.redirectTo },
  });
  // Link do próprio app com o token_hash: um GET automático (scanner) não consome
  // o token; só o clique em "Continuar" na página chama verifyOtp.
  const hashedToken = data?.properties?.hashed_token;
  const actionLink = hashedToken
    ? `${new URL(input.redirectTo).origin}/redefinir-senha?token_hash=${encodeURIComponent(hashedToken)}&type=recovery`
    : data?.properties?.action_link;
  if (error || !actionLink) {
    // Usuário inexistente cai aqui também: a resposta ao cliente segue genérica.
    logger.info("password_recovery_skipped", { reason: error?.code ?? "no_action_link" });
    return { sent: false };
  }

  const config = getEmailSenderConfig();
  if (!config.configured) {
    logger.warn("password_recovery_skipped", { reason: config.reason });
    return { sent: false };
  }

  const from = process.env.PASSWORD_RESET_EMAIL_FROM?.trim() || config.from;
  const supportEmail = process.env.PASSWORD_RESET_SUPPORT_EMAIL?.trim() || DEFAULT_SUPPORT_EMAIL;
  const result = await sendAccessEmail({
    to: input.email,
    content: buildPasswordRecoveryEmailContent({ actionLink, supportEmail }),
    config: { ...config, from },
  });
  if (!result.ok) {
    logger.warn("password_recovery_send_failed", { reason: result.error });
    return { sent: false };
  }
  return { sent: true };
}

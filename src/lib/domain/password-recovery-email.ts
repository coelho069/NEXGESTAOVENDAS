import type { AccessEmailContent } from "@/lib/domain/onboarding-visitor";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * E-mail de redefinição de senha. O link vem do Auth (generateLink), que não
 * envia nada por conta própria: quem envia é o SMTP do app.
 */
export function buildPasswordRecoveryEmailContent(input: {
  actionLink: string;
  supportEmail: string;
}): AccessEmailContent {
  const url = new URL(input.actionLink);
  if (url.protocol !== "https:") throw new Error("recovery_link_must_be_https");

  const link = url.toString();
  const support = input.supportEmail.trim();
  const safeLink = escapeHtml(link);
  const safeSupport = escapeHtml(support);

  const text = [
    "Olá!",
    "",
    "Recebemos um pedido para redefinir a senha da sua conta no Nex Gestão Vendas.",
    "",
    "Para criar uma nova senha, acesse o link abaixo:",
    link,
    "",
    "O link é de uso único e expira em breve.",
    "",
    "Se você não pediu a redefinição, ignore este e-mail. Sua senha continua a mesma.",
    "",
    `Dúvidas: ${support}`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Redefinir sua senha</title>
  </head>
  <body style="margin:0;padding:0;background:#0B1220;">
    <div style="background:#0B1220;font-family:'Segoe UI',Arial,sans-serif;padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;margin:0 auto;">
        <tr>
          <td align="center" style="padding:0 0 24px;">
            <div style="font-size:22px;font-weight:800;color:#F1F5F9;">NEX <span style="color:#60A5FA;">Gestão Vendas</span></div>
          </td>
        </tr>
        <tr>
          <td style="background:#101828;border:1px solid #1E293B;border-radius:16px;padding:36px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding:0 0 20px;">
                  <div style="width:48px;height:4px;border-radius:4px;background:linear-gradient(135deg,#2563EB,#1D4ED8);font-size:0;line-height:0;">&nbsp;</div>
                </td>
              </tr>
              <tr>
                <td style="padding:0 0 12px;font-size:22px;font-weight:700;color:#F1F5F9;">
                  <h1 style="margin:0;font-size:22px;font-weight:700;color:#F1F5F9;">Redefinir sua senha</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:0 0 28px;font-size:15px;line-height:1.6;color:#94A3B8;">
                  Recebemos um pedido para redefinir a senha da sua conta. Clique no botão abaixo para escolher uma nova senha.
                </td>
              </tr>
              <tr>
                <td style="padding:0 0 28px;">
                  <a href="${safeLink}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:linear-gradient(135deg,#2563EB,#1D4ED8);color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;">Redefinir senha</a>
                </td>
              </tr>
              <tr>
                <td style="padding:0 0 8px;font-size:13px;line-height:1.6;color:#94A3B8;">
                  Se o botão não funcionar, copie e cole este link no navegador:
                </td>
              </tr>
              <tr>
                <td style="padding:0 0 28px;font-size:13px;line-height:1.6;word-break:break-all;">
                  <a href="${safeLink}" style="color:#60A5FA;word-break:break-all;">${safeLink}</a>
                </td>
              </tr>
              <tr>
                <td style="padding:24px 0 0;border-top:1px solid #1E293B;font-size:13px;line-height:1.6;color:#64748B;">
                  Se você não fez esse pedido, ignore este e-mail. Sua senha continua a mesma.
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:24px 0 0;font-size:12px;color:#475569;">
            NEX Gestão Vendas &middot; ${safeSupport}
          </td>
        </tr>
      </table>
    </div>
  </body>
</html>`;

  return {
    subject: "Redefinição de senha — Nex Gestão Vendas",
    text,
    html,
  };
}

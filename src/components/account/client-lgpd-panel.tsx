import Link from "next/link";
import { PRIVACY_POLICY_PATH } from "@/lib/domain/privacy-policy";
import { ANNE_SUPPORT_EMAIL } from "@/lib/support/anne-chat";
import { landingTheme as t } from "@/components/landing/theme/landing-theme";

/**
 * Guia operacional para a loja atender pedidos LGPD de clientes do PDV.
 * Não substitui DPO nem parecer jurídico.
 */
export function ClientLgpdPanel() {
  return (
    <div className="space-y-4" data-testid="settings-lgpd-panel">
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: t.color.textBody }}>
        A loja é, em regra, a <strong style={{ color: t.color.text }}>controladora</strong> dos dados
        dos clientes cadastrados no PDV. Use estas ferramentas para responder pedidos de acesso,
        correção ou eliminação quando for o caso.
      </p>

      <ol
        style={{
          margin: 0,
          paddingLeft: 18,
          fontSize: 14,
          lineHeight: 1.6,
          color: t.color.textBody,
        }}
      >
        <li>
          Confirme a identidade do titular (documento / e-mail) antes de enviar qualquer arquivo.
        </li>
        <li>
          Em <Link href="/clientes" style={{ color: t.color.accent, fontWeight: 600 }}>Clientes</Link>
          , abra o cadastro → <strong style={{ color: t.color.text }}>Exportar dados (LGPD)</strong>{" "}
          para baixar JSON com cadastro e vendas.
        </li>
        <li>
          Para eliminação de identificadores:{" "}
          <strong style={{ color: t.color.text }}>Anonimizar cadastro</strong>. O histórico de vendas
          permanece (obrigação fiscal/contábil pode exigir), sem nome/documento/e-mail.
        </li>
        <li>
          Correção: use <strong style={{ color: t.color.text }}>Editar</strong> no mesmo cadastro.
        </li>
      </ol>

      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: t.color.textMuted }}>
        Pedidos sobre a <em>conta de assinatura</em> do Nex (login/cobrança): e-mail{" "}
        <a href={`mailto:${ANNE_SUPPORT_EMAIL}`} style={{ color: t.color.accent, fontWeight: 600 }}>
          {ANNE_SUPPORT_EMAIL}
        </a>{" "}
        com assunto “Pedido LGPD — titular”. Leia o{" "}
        <Link href={PRIVACY_POLICY_PATH} style={{ color: t.color.accent, fontWeight: 600 }}>
          Aviso de Privacidade
        </Link>
        .
      </p>

      <p
        role="note"
        style={{
          margin: 0,
          fontSize: 12.5,
          lineHeight: 1.5,
          color: t.color.textMuted,
          padding: "10px 12px",
          borderRadius: t.radius.md,
          border: `1px solid ${t.color.border}`,
          background: "rgba(255,255,255,0.03)",
        }}
      >
        Este painel ajuda a operação. Não certifica conformidade. Defina encarregado (DPO), bases
        legais e prazos de retenção com assessoria jurídica da sua empresa.
      </p>
    </div>
  );
}

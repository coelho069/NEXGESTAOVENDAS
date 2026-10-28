import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  PRIVACY_POLICY_PATH,
  REFUND_POLICY_PATH,
  type PublicCompanyProfile,
} from "@/lib/domain/privacy-policy";
import { isUsablePublicEmail } from "@/lib/domain/refund-policy";
import { landingTheme as t } from "@/components/landing/theme/landing-theme";

export type PrivacyPolicyPageProps = {
  company: PublicCompanyProfile;
  effectiveDateIso: string;
};

function formatEffectiveDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

const SECTIONS = [
  { id: "aviso", label: "Aviso importante" },
  { id: "controladores", label: "Quem controla os dados" },
  { id: "dados-conta", label: "Dados da conta SaaS" },
  { id: "dados-pdv", label: "Dados no PDV da loja" },
  { id: "cookies", label: "Cookies" },
  { id: "direitos", label: "Direitos do titular" },
  { id: "como-pedir", label: "Como exercer direitos" },
  { id: "seguranca", label: "Segurança e retenção" },
  { id: "contato", label: "Contato" },
  { id: "vigencia", label: "Vigência" },
] as const;

const CSS = `
.nx-policy-link {
  color: ${t.color.accent};
  font-weight: 600;
  text-decoration: none;
  transition: color ${t.motion.fast} ease;
}
.nx-policy-link:hover, .nx-policy-link:focus-visible { color: #6EE7B7; outline: none; }
.nx-policy-nav-link {
  color: ${t.color.textBody};
  text-decoration: none;
  transition: color ${t.motion.fast} ease;
}
.nx-policy-nav-link:hover, .nx-policy-nav-link:focus-visible { color: ${t.color.text}; outline: none; }
.nx-policy-back {
  color: ${t.color.textBody};
  text-decoration: none;
  border-radius: ${t.radius.md};
  transition: color ${t.motion.fast} ease, background ${t.motion.fast} ease;
}
.nx-policy-back:hover, .nx-policy-back:focus-visible {
  color: ${t.color.text};
  background: rgba(255, 255, 255, 0.06);
  outline: none;
}
`;

const page: CSSProperties = {
  minHeight: "100vh",
  background: t.color.bg,
  color: t.color.textBody,
  fontFamily: t.font.body,
  WebkitFontSmoothing: "antialiased",
  position: "relative",
  overflowX: "hidden",
};

const glassCard: CSSProperties = {
  borderRadius: t.radius.xl,
  border: `1px solid ${t.color.glassBorder}`,
  background: t.color.glassBg,
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  boxShadow: `${t.shadow.card}, 0 0 0 1px rgba(255, 255, 255, 0.03) inset`,
};

const heading: CSSProperties = { color: t.color.text, fontFamily: t.font.heading };
const muted: CSSProperties = { color: t.color.textMuted };
const strong: CSSProperties = { color: t.color.text };
const brandMark: CSSProperties = {
  background: `linear-gradient(135deg, ${t.color.secondary}, ${t.color.accent})`,
  color: "#fff",
};

export function PrivacyPolicyPage({ company, effectiveDateIso }: PrivacyPolicyPageProps) {
  const supportMailto = isUsablePublicEmail(company.supportEmail)
    ? `mailto:${company.supportEmail}`
    : null;
  const supportLabel = isUsablePublicEmail(company.supportEmail)
    ? company.supportEmail
    : "e-mail de suporte (a informar nas configurações públicas)";

  return (
    <div style={page}>
      <style>{CSS}</style>
      <div
        aria-hidden="true"
        style={{
          pointerEvents: "none",
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(900px 480px at 50% -80px, rgba(37, 99, 235, 0.16) 0%, rgba(37, 99, 235, 0.04) 48%, transparent 72%), radial-gradient(640px 360px at 100% 100%, rgba(16, 185, 129, 0.08) 0%, transparent 65%)",
        }}
      />
      <div style={{ position: "relative", zIndex: 1 }}>
        <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
          <Link href="/" className="nx-policy-back inline-flex items-center gap-2 px-2 py-1.5 text-sm font-medium">
            <ArrowLeft size={16} aria-hidden="true" />
            Voltar ao início
          </Link>
          <Link href={REFUND_POLICY_PATH} className="nx-policy-link text-sm">
            Política de reembolso
          </Link>
        </header>

        <main className="mx-auto grid max-w-6xl gap-8 px-4 pb-16 sm:px-6 lg:grid-cols-[220px_1fr]">
          <nav aria-label="Seções do aviso" className="hidden lg:block">
            <div className="sticky top-6 space-y-2 p-4" style={glassCard}>
              <p className="text-xs font-bold uppercase tracking-wider" style={heading}>
                Neste aviso
              </p>
              <ul className="mt-3 space-y-2 text-sm">
                {SECTIONS.map((section) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`} className="nx-policy-nav-link">
                      {section.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>

          <article className="space-y-6">
            <div className="p-6 sm:p-8" style={glassCard}>
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: t.color.accent }}>
                Transparência · LGPD
              </p>
              <h1
                className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl"
                style={heading}
              >
                Aviso de Privacidade — {company.tradeName}
              </h1>
              <p className="mt-3 text-sm leading-relaxed" style={muted}>
                Este texto explica, em linguagem simples, quais dados o Nex trata na operação do
                software e como a loja pode atender pedidos de titulares.{" "}
                <strong style={strong}>Não é certificação jurídica nem parecer de advogado</strong>; a
                conformidade completa depende do cadastro da empresa, das bases legais do negócio e de
                revisão humana.
              </p>
              <p className="mt-2 text-xs" style={muted}>
                Vigência: {formatEffectiveDate(effectiveDateIso)} · Identidade pública:{" "}
                {company.legalName} · CNPJ: {company.cnpj}
              </p>
            </div>

            <div className="space-y-8 p-6 sm:p-8" style={glassCard}>
              <section id="aviso" className="scroll-mt-24">
                <h2 className="text-lg font-bold" style={heading}>
                  1. Aviso importante
                </h2>
                <p className="mt-3 text-sm leading-relaxed">
                  O Nex Gestão Vendas é um software de PDV, estoque e gestão. O comprovante interno de
                  venda <strong style={strong}>não substitui</strong> documento fiscal da SEFAZ. Este
                  aviso cobre privacidade de dados pessoais no uso da plataforma.
                </p>
              </section>

              <section id="controladores" className="scroll-mt-24">
                <h2 className="text-lg font-bold" style={heading}>
                  2. Quem controla os dados
                </h2>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
                  <li>
                    <strong style={strong}>Conta e assinatura do software:</strong> a operação do SaaS
                    ({company.tradeName}) trata dados necessários para login, cobrança e suporte.
                  </li>
                  <li>
                    <strong style={strong}>Clientes cadastrados no PDV da loja:</strong> a loja (sua
                    organização) é, em regra, a controladora desses dados. O Nex processa o cadastro
                    para prestar o serviço à loja.
                  </li>
                </ul>
              </section>

              <section id="dados-conta" className="scroll-mt-24">
                <h2 className="text-lg font-bold" style={heading}>
                  3. Dados da conta SaaS
                </h2>
                <p className="mt-3 text-sm leading-relaxed">
                  Podemos tratar e-mail, nome de usuário, dados de assinatura/pagamento (via
                  processador, ex.: Mercado Pago), registros de suporte e logs técnicos de acesso.
                  Finalidades típicas: autenticar, cobrar a assinatura, prevenir fraude e prestar
                  suporte.
                </p>
              </section>

              <section id="dados-pdv" className="scroll-mt-24">
                <h2 className="text-lg font-bold" style={heading}>
                  4. Dados no PDV da loja
                </h2>
                <p className="mt-3 text-sm leading-relaxed">
                  A loja pode cadastrar nome, documento e e-mail de clientes, além do histórico de
                  vendas vinculado. Esses campos são opcionais no cadastro (exceto o nome). A loja
                  deve informar seus clientes e definir a base legal adequada ao seu negócio.
                </p>
              </section>

              <section id="cookies" className="scroll-mt-24">
                <h2 className="text-lg font-bold" style={heading}>
                  5. Cookies
                </h2>
                <p className="mt-3 text-sm leading-relaxed">
                  Usamos cookies e armazenamento local <strong style={strong}>essenciais</strong> para
                  sessão autenticada, segurança (CSRF) e funcionamento offline do PDV. Não usamos, neste
                  momento, cookies de marketing/analytics de terceiros neste produto. Por isso não há
                  banner de consentimento de marketing — apenas este aviso.
                </p>
              </section>

              <section id="direitos" className="scroll-mt-24">
                <h2 className="text-lg font-bold" style={heading}>
                  6. Direitos do titular (LGPD)
                </h2>
                <p className="mt-3 text-sm leading-relaxed">
                  Nos termos da Lei nº 13.709/2018, o titular pode solicitar confirmação de tratamento,
                  acesso, correção, anonimização, bloqueio ou eliminação (quando cabível), portabilidade
                  (quando aplicável), informação sobre compartilhamentos e revogação de consentimento
                  quando essa for a base legal.
                </p>
              </section>

              <section id="como-pedir" className="scroll-mt-24">
                <h2 className="text-lg font-bold" style={heading}>
                  7. Como exercer direitos
                </h2>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
                  <li>
                    <strong style={strong}>Dados de clientes da loja:</strong> peça à loja onde comprou.
                    No Nex, operadores autenticados podem exportar ou anonimizar o cadastro em{" "}
                    <em>Clientes</em> e consultar o guia em <em>Configurações → Privacidade (LGPD)</em>.
                  </li>
                  <li>
                    <strong style={strong}>Dados da sua conta Nex (assinatura/login):</strong> escreva
                    para{" "}
                    {supportMailto ? (
                      <a className="nx-policy-link" href={supportMailto}>
                        {supportLabel}
                      </a>
                    ) : (
                      <span>{supportLabel}</span>
                    )}{" "}
                    com o assunto “Pedido LGPD — titular”.
                  </li>
                </ul>
              </section>

              <section id="seguranca" className="scroll-mt-24">
                <h2 className="text-lg font-bold" style={heading}>
                  8. Segurança e retenção
                </h2>
                <p className="mt-3 text-sm leading-relaxed">
                  Tráfego protegido por HTTPS; acesso ao app autenticado. Há trilha de auditoria
                  operacional no backend para eventos de venda/estoque. Prazos de retenção de dados da
                  loja devem ser definidos pela própria loja (obrigação fiscal/contábil pode exigir
                  guardar histórico mesmo após anonimizar o cadastro do cliente). Uma política de
                  retenção automática completa ainda é backlog de produto.
                </p>
              </section>

              <section id="contato" className="scroll-mt-24">
                <h2 className="text-lg font-bold" style={heading}>
                  9. Contato
                </h2>
                <p className="mt-3 text-sm leading-relaxed">
                  Canal preferencial:{" "}
                  {supportMailto ? (
                    <a className="nx-policy-link" href={supportMailto}>
                      {supportLabel}
                    </a>
                  ) : (
                    <span>{supportLabel}</span>
                  )}
                  . Foro e identificação completa da empresa seguem os dados públicos cadastrados (
                  {company.jurisdiction}). Encarregado (DPO) e texto jurídico definitivo devem ser
                  definidos pela operação com assessoria legal.
                </p>
              </section>

              <section id="vigencia" className="scroll-mt-24">
                <h2 className="text-lg font-bold" style={heading}>
                  10. Vigência
                </h2>
                <p className="mt-3 text-sm leading-relaxed">
                  Este aviso vale a partir de {formatEffectiveDate(effectiveDateIso)}. Atualizações
                  podem ser publicadas nesta mesma URL ({PRIVACY_POLICY_PATH}). Veja também a{" "}
                  <Link href={REFUND_POLICY_PATH} className="nx-policy-link">
                    Política de Reembolsos
                  </Link>
                  .
                </p>
              </section>
            </div>
          </article>
        </main>

        <footer className="py-12" style={{ borderTop: `1px solid ${t.color.border}`, background: "rgba(15, 23, 42, 0.45)" }}>
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold" style={brandMark}>
                    N
                  </span>
                  <span className="text-sm font-bold uppercase tracking-wider" style={heading}>
                    Nex Gestão Vendas
                  </span>
                </div>
                <p className="mt-3 max-w-xs text-sm leading-relaxed" style={muted}>
                  Plataforma de vendas com PDV, estoque e gestão para o varejo.
                </p>
              </div>
              <nav aria-label="Links do rodapé" className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm">
                <Link href="/" className="nx-policy-nav-link">
                  Início
                </Link>
                <Link href="/planos" className="nx-policy-nav-link">
                  Planos
                </Link>
                <Link href="/login" className="nx-policy-nav-link">
                  Login
                </Link>
                <Link href={PRIVACY_POLICY_PATH} className="nx-policy-nav-link">
                  Aviso de privacidade
                </Link>
                <Link href={REFUND_POLICY_PATH} className="nx-policy-nav-link">
                  Política de reembolso
                </Link>
              </nav>
            </div>
            <div className="mt-10 pt-6" style={{ borderTop: `1px solid ${t.color.border}` }}>
              <p className="text-xs" style={muted}>
                © {new Date().getUTCFullYear()} Nex Gestão Vendas. Todos os direitos reservados.
              </p>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

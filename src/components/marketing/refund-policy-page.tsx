import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  REFUND_POLICY_PATH,
  type PublicCompanyProfile,
  isUsablePublicEmail,
} from "@/lib/domain/refund-policy";
import { PRIVACY_POLICY_PATH } from "@/lib/domain/privacy-policy";
import { landingTheme as t } from "@/components/landing/theme/landing-theme";

export type RefundPolicyPageProps = {
  company: PublicCompanyProfile;
  refundWindowDays: number;
  yearlyPlanRefundWindowDays: number;
  reviewBusinessDays: number;
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
  { id: "quem-somos", label: "Quem somos e o que é cobrado" },
  { id: "prazo", label: "Prazo para solicitar reembolso" },
  { id: "como-solicitar", label: "Como solicitar" },
  { id: "analise-e-estorno", label: "Análise e estorno" },
  { id: "quando-nao-ha-reembolso", label: "Quando não há reembolso" },
  { id: "cancelamento-vs-reembolso", label: "Cancelamento vs reembolso" },
  { id: "pix", label: "Pagamentos via PIX" },
  { id: "contato-e-foro", label: "Contato e foro" },
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

const innerCard: CSSProperties = {
  borderRadius: t.radius.lg,
  border: `1px solid ${t.color.border}`,
  background: "rgba(15, 23, 42, 0.45)",
};

const heading: CSSProperties = {
  color: t.color.text,
  fontFamily: t.font.heading,
  letterSpacing: "-0.02em",
};

const strong: CSSProperties = { color: t.color.text, fontWeight: 600 };
const muted: CSSProperties = { color: t.color.textMuted };
const label: CSSProperties = { color: t.color.textMuted };
const value: CSSProperties = { color: t.color.text, fontWeight: 500 };

const brandMark: CSSProperties = {
  background: `linear-gradient(135deg, ${t.color.secondary} 0%, ${t.color.accent} 100%)`,
  color: "#FFFFFF",
  boxShadow: t.shadow.ctaGlow,
};

export function RefundPolicyPage({
  company,
  refundWindowDays,
  yearlyPlanRefundWindowDays,
  reviewBusinessDays,
  effectiveDateIso,
}: RefundPolicyPageProps) {
  const effectiveDateLabel = formatEffectiveDate(effectiveDateIso);
  const missingCorporateData = !company.hasRegisteredLegalName || !company.hasRegisteredCnpj;
  const supportMailto = isUsablePublicEmail(company.supportEmail)
    ? `mailto:${company.supportEmail}`
    : null;

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
        <header
          className="sticky top-0 z-40 backdrop-blur"
          style={{
            background: t.color.glassBg,
            borderBottom: `1px solid ${t.color.border}`,
            WebkitBackdropFilter: "blur(20px)",
          }}
        >
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2.5" aria-label="Nex Gestão Vendas — início" style={{ textDecoration: "none" }}>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold" style={brandMark}>
                N
              </span>
              <span className="text-sm font-bold uppercase tracking-wider sm:text-base" style={heading}>
                Nex Gestão Vendas
              </span>
            </Link>
            <Link
              href="/planos"
              className="nx-policy-back inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold"
            >
              <ArrowLeft size={16} aria-hidden="true" />
              Voltar aos planos
            </Link>
          </div>
        </header>

        <main>
          <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
            <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: t.color.accent }}>
              Documento público
            </p>
            <h1 className="mt-3 text-3xl font-bold sm:text-4xl" style={{ ...heading, fontWeight: 800 }}>
              Política de Reembolsos e Devoluções — Nex Gestão Vendas
            </h1>
            <p className="mt-4 text-base leading-relaxed" style={muted}>
              Esta página explica, em linguagem direta, quando a assinatura do {company.tradeName}{" "}
              pode ser estornada, como pedir o reembolso e o que não gera devolução. Vale para cobranças
              da plataforma (software de gestão de vendas), não para vendas feitas pelo seu PDV aos seus
              clientes.
            </p>
            <p className="mt-2 text-sm" style={muted}>
              Vigente a partir de {effectiveDateLabel}. Endereço canônico:{" "}
              <a className="nx-policy-link" href={REFUND_POLICY_PATH}>
                {REFUND_POLICY_PATH}
              </a>
              .
            </p>

            <nav aria-label="Seções desta política" className="mt-10 p-5" style={glassCard}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={label}>Nesta página</p>
              <ol className="mt-3 grid gap-2 text-sm sm:grid-cols-2" style={{ color: t.color.textBody }}>
                {SECTIONS.map((section, index) => (
                  <li key={section.id}>
                    <a className="nx-policy-nav-link" href={`#${section.id}`}>
                      {index + 1}. {section.label}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="mt-12 space-y-12 text-sm leading-relaxed" style={{ color: t.color.textBody }}>
              <section id="quem-somos" className="scroll-mt-24">
                <h2 className="text-xl font-semibold tracking-tight" style={heading}>
                  1. Quem somos e o que é cobrado
                </h2>
                <p className="mt-3">
                  O {company.tradeName} é um software de gestão de vendas (SaaS): PDV, estoque, clientes,
                  dashboard e recursos do plano contratado. A contratação pública é cobrada pelo Mercado
                  Pago (Checkout Pro): um pagamento do período contratado, mensal ou anual conforme o
                  plano. Não vendemos produto físico nesta contratação — não há envio, troca de
                  mercadoria nem devolução de item em caixa.
                </p>
                <dl className="mt-4 grid gap-2 p-4" style={glassCard}>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide" style={label}>Nome comercial</dt>
                    <dd className="mt-0.5 font-medium" style={value}>{company.tradeName}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide" style={label}>Razão social</dt>
                    <dd className="mt-0.5 font-medium" style={value}>{company.legalName}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide" style={label}>CNPJ</dt>
                    <dd className="mt-0.5 font-medium" style={value}>{company.cnpj}</dd>
                  </div>
                </dl>
                {missingCorporateData ? (
                  <p className="mt-3 text-xs" style={muted}>
                    Razão social e CNPJ aparecem como placeholders até serem cadastrados nas variáveis
                    públicas da aplicação. Não inventamos esses dados.
                  </p>
                ) : null}
              </section>

              <section id="prazo" className="scroll-mt-24">
                <h2 className="text-xl font-semibold tracking-tight" style={heading}>
                  2. Prazo para solicitar reembolso
                </h2>
                <p className="mt-3">
                  Você pode pedir reembolso da <strong className="font-semibold" style={strong}>primeira cobrança paga</strong>{" "}
                  em até <strong className="font-semibold" style={strong}>{refundWindowDays} dias corridos</strong> após
                  a data do pagamento, se a conta não tiver sido usada de forma intensiva em produção.
                </p>
                <p className="mt-3">
                  Uso intensivo, para esta política, inclui pelo menos um destes casos: emissão de documento
                  fiscal em ambiente de produção; volume relevante de vendas reais no PDV (além de testes
                  pontuais); ou operação contínua da loja já com a assinatura ativa.
                </p>
                <p className="mt-3">
                  Período de trial (quando existir) não gera estorno — não houve cobrança. O prazo de{" "}
                  {refundWindowDays} dias conta a partir da primeira cobrança efetivamente paga, não do
                  cadastro.
                </p>
                <p className="mt-3">
                  No plano anual, o mesmo prazo de {yearlyPlanRefundWindowDays} dias corridos após a primeira
                  cobrança paga se aplica. Depois disso, o valor do ciclo anual já iniciado não é rateado
                  nem devolvido proporcionalmente.
                </p>
              </section>

              <section id="como-solicitar" className="scroll-mt-24">
                <h2 className="text-xl font-semibold tracking-tight" style={heading}>3. Como solicitar</h2>
                <p className="mt-3">
                  O pedido é registrado na área autenticada, pelo botão Solicitar reembolso, somente para um
                  pagamento elegível da própria conta. O envio não devolve o valor. O prazo de {refundWindowDays}{" "}
                  dias é conferido a partir do instante do pagamento em America/Sao_Paulo.
                </p>
                <p className="mt-4">
                  Se o formulário não abrir, envie um e-mail para o suporte com o assunto “Pedido de
                  reembolso — Nex Gestão Vendas” e os mesmos dados. E-mail de suporte:{" "}
                  {supportMailto ? (
                    <a className="nx-policy-link" href={supportMailto}>
                      {company.supportEmail}
                    </a>
                  ) : (
                    <span className="font-semibold" style={strong}>{company.supportEmail}</span>
                  )}
                  . WhatsApp pode orientar, mas o registro formal é o formulário ou o e-mail.
                </p>
              </section>

              <section id="analise-e-estorno" className="scroll-mt-24">
                <h2 className="text-xl font-semibold tracking-tight" style={heading}>
                  4. Análise e estorno
                </h2>
                <p className="mt-3">
                  Analisamos o pedido em até {reviewBusinessDays} dias úteis depois do registro completo.
                  Registrar ou aprovar o pedido nesta página não movimenta dinheiro. Se o reembolso for
                  aprovado, o estorno é feito depois pelo Mercado Pago, no mesmo meio da cobrança original.
                </p>
                <p className="mt-3">
                  O crédito no extrato do cartão ou na conta do PIX depende do banco — em geral alguns
                  dias úteis depois que o Mercado Pago confirma o estorno. Não controlamos esse prazo.
                  Quando aprovado, enviamos a confirmação no mesmo e-mail usado no pedido.
                </p>
              </section>

              <section id="quando-nao-ha-reembolso" className="scroll-mt-24">
                <h2 className="text-xl font-semibold tracking-tight" style={heading}>
                  5. Quando não há reembolso
                </h2>
                <p className="mt-3">Não estornamos, entre outras situações:</p>
                <ul className="mt-3 list-disc space-y-1 pl-5">
                  <li>
                    ciclo já utilizado depois do trial ou depois dos {refundWindowDays} dias da primeira
                    cobrança;
                  </li>
                  <li>
                    uma nova contratação fora da janela da primeira cobrança paga, ainda que o período
                    esteja em curso;
                  </li>
                  <li>
                    conta com emissão fiscal em produção ou uso intensivo do PDV no período cujo estorno
                    foi pedido;
                  </li>
                  <li>
                    plano anual após {yearlyPlanRefundWindowDays} dias da primeira cobrança paga — não há
                    devolução do saldo dos meses restantes;
                  </li>
                  <li>
                    contestação/chargeback no cartão ou PIX sem ter registrado o pedido, ou de forma
                    reiterada/abusiva;
                  </li>
                  <li>cobrança gerada por uso da sua loja (vendas no PDV a clientes finais).</li>
                </ul>
              </section>

              <section id="cancelamento-vs-reembolso" className="scroll-mt-24">
                <h2 className="text-xl font-semibold tracking-tight" style={heading}>
                  6. Cancelamento vs reembolso
                </h2>
                <p className="mt-3">
                  O checkout público é um pagamento único do período contratado. Encerrar o acesso não
                  devolve esse pagamento e não há renovação automática nesse fluxo. Cancelar{" "}
                  <strong className="font-semibold" style={strong}>não</strong> estorna o período já pago.
                </p>
                <p className="mt-3">
                  Reembolso é um pedido separado, só nas hipóteses desta política, e só sobre cobrança já
                  paga. Se quiser só parar de ser cobrado de novo, peça o cancelamento; se quiser o dinheiro
                  da primeira cobrança de volta, peça o reembolso dentro do prazo.
                </p>
              </section>

              <section id="pix" className="scroll-mt-24">
                <h2 className="text-xl font-semibold tracking-tight" style={heading}>7. Pagamentos via PIX</h2>
                <p className="mt-3">
                  Quando o plano for pago via PIX no Mercado Pago, o estorno aprovado volta pela mesma
                  transação PIX. O crédito na conta do pagador pode levar de algumas horas a alguns dias
                  úteis, conforme o banco. O prazo não é o mesmo do cartão e não depende só da nossa análise.
                </p>
              </section>

              <section id="contato-e-foro" className="scroll-mt-24">
                <h2 className="text-xl font-semibold tracking-tight" style={heading}>8. Contato e foro</h2>
                <p className="mt-3">
                  Dúvidas e pedidos:{" "}
                  {supportMailto ? (
                    <a className="nx-policy-link" href={supportMailto}>
                      {company.supportEmail}
                    </a>
                  ) : (
                    <span className="font-semibold" style={strong}>{company.supportEmail}</span>
                  )}
                  .
                </p>
                <p className="mt-3">
                  Esta política é regida pelas leis do Brasil. Fica eleito o foro brasileiro
                  {company.jurisdiction && company.jurisdiction !== "Brasil"
                    ? ` (comarca no Estado de ${company.jurisdiction})`
                    : ""}
                  , sem prejuízo de direitos do consumidor no seu domicílio.
                </p>
              </section>

              <section id="vigencia" className="scroll-mt-24">
                <h2 className="text-xl font-semibold tracking-tight" style={heading}>9. Vigência</h2>
                <p className="mt-3">
                  Versão vigente a partir de <strong className="font-semibold" style={strong}>{effectiveDateLabel}</strong>{" "}
                  ({effectiveDateIso}). Alterações futuras passam a valer para novas cobranças a partir da
                  data publicada nesta URL. Pedidos já abertos seguem a versão em vigor no dia do pedido.
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

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  REFUND_POLICY_PATH,
  type PublicCompanyProfile,
  isUsablePublicEmail,
} from "@/lib/domain/refund-policy";

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
    <div className="min-h-screen bg-white text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Nex Gestão Vendas — início">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white shadow-sm">
              N
            </span>
            <span className="text-sm font-bold uppercase tracking-wider text-slate-900 sm:text-base">
              Nex Gestão Vendas
            </span>
          </Link>
          <Link
            href="/#planos"
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Voltar aos planos
          </Link>
        </div>
      </header>

      <main className="bg-slate-50">
        <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Documento público</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Política de Reembolsos e Devoluções — Nex Gestão Vendas
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            Esta página explica, em linguagem direta, quando a assinatura do {company.tradeName}{" "}
            pode ser estornada, como pedir o reembolso e o que não gera devolução. Vale para cobranças
            da plataforma (software de gestão de vendas), não para vendas feitas pelo seu PDV aos seus
            clientes.
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Vigente a partir de {effectiveDateLabel}. Endereço canônico:{" "}
            <a className="font-medium text-emerald-700 hover:text-emerald-800" href={REFUND_POLICY_PATH}>
              {REFUND_POLICY_PATH}
            </a>
            .
          </p>

          <nav
            aria-label="Seções desta política"
            className="mt-10 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nesta página</p>
            <ol className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
              {SECTIONS.map((section, index) => (
                <li key={section.id}>
                  <a className="hover:text-emerald-700" href={`#${section.id}`}>
                    {index + 1}. {section.label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="mt-12 space-y-12 text-sm leading-relaxed text-slate-600">
            <section id="quem-somos" className="scroll-mt-24">
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                1. Quem somos e o que é cobrado
              </h2>
              <p className="mt-3">
                O {company.tradeName} é um software de gestão de vendas (SaaS): PDV, estoque, clientes,
                dashboard e recursos do plano contratado. A cobrança é a assinatura recorrente da
                plataforma (mensal ou anual, conforme o plano), processada pelo Stripe. Não vendemos
                produto físico nesta contratação — não há envio, troca de mercadoria nem devolução de
                item em caixa.
              </p>
              <dl className="mt-4 grid gap-2 rounded-2xl border border-slate-200 bg-white p-4">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nome comercial</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">{company.tradeName}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Razão social</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">{company.legalName}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">CNPJ</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">{company.cnpj}</dd>
                </div>
              </dl>
              {missingCorporateData ? (
                <p className="mt-3 text-xs text-slate-500">
                  Razão social e CNPJ aparecem como placeholders até serem cadastrados nas variáveis
                  públicas da aplicação. Não inventamos esses dados.
                </p>
              ) : null}
            </section>

            <section id="prazo" className="scroll-mt-24">
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                2. Prazo para solicitar reembolso
              </h2>
              <p className="mt-3">
                Você pode pedir reembolso da <strong className="font-semibold text-slate-800">primeira cobrança paga</strong>{" "}
                em até <strong className="font-semibold text-slate-800">{refundWindowDays} dias corridos</strong> após
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
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">3. Como solicitar</h2>
              <p className="mt-3">
                Envie um e-mail para o suporte com o assunto “Pedido de reembolso — Nex Gestão Vendas”.
                Informe:
              </p>
              <ul className="mt-3 list-disc space-y-1 pl-5">
                <li>o e-mail da conta assinante;</li>
                <li>o ID da fatura ou da sessão de pagamento no Stripe (começa com <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">in_</code> ou <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">cs_</code>, visível no comprovante);</li>
                <li>o motivo do pedido, em poucas linhas;</li>
                <li>se já emitiu documento fiscal ou processou vendas reais nesta conta.</li>
              </ul>
              <p className="mt-4">
                E-mail de suporte:{" "}
                {supportMailto ? (
                  <a className="font-semibold text-emerald-700 hover:text-emerald-800" href={supportMailto}>
                    {company.supportEmail}
                  </a>
                ) : (
                  <span className="font-semibold text-slate-800">{company.supportEmail}</span>
                )}
                . Pedidos só pelo canal de e-mail entram na fila de análise; WhatsApp pode orientar, mas
                o registro formal do reembolso é o e-mail.
              </p>
            </section>

            <section id="analise-e-estorno" className="scroll-mt-24">
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                4. Análise e estorno
              </h2>
              <p className="mt-3">
                Analisamos o pedido em até {reviewBusinessDays} dias úteis após o e-mail completo. Se o
                reembolso for aprovado, o estorno é feito pelo Stripe no mesmo meio de pagamento da
                cobrança original.
              </p>
              <p className="mt-3">
                O crédito no extrato do cartão depende do banco ou da bandeira — em geral alguns dias
                úteis após o Stripe confirmar o refund. Não controlamos esse prazo do emissor. Quando
                aprovado, enviamos a confirmação no mesmo e-mail usado no pedido.
              </p>
            </section>

            <section id="quando-nao-ha-reembolso" className="scroll-mt-24">
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                5. Quando não há reembolso
              </h2>
              <p className="mt-3">Não estornamos, entre outras situações:</p>
              <ul className="mt-3 list-disc space-y-1 pl-5">
                <li>
                  ciclo já utilizado depois do trial ou depois dos {refundWindowDays} dias da primeira
                  cobrança;
                </li>
                <li>renovações seguintes (segunda cobrança em diante), ainda que o período esteja em curso;</li>
                <li>
                  conta com emissão fiscal em produção ou uso intensivo do PDV no período cujo estorno
                  foi pedido;
                </li>
                <li>
                  plano anual após {yearlyPlanRefundWindowDays} dias da primeira cobrança paga — não há
                  devolução do saldo dos meses restantes;
                </li>
                <li>
                  contestação/chargeback no cartão ou PIX sem ter pedido reembolso por e-mail, ou de
                  forma reiterada/abusiva;
                </li>
                <li>cobrança gerada por uso da sua loja (vendas no PDV a clientes finais).</li>
              </ul>
            </section>

            <section id="cancelamento-vs-reembolso" className="scroll-mt-24">
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                6. Cancelamento vs reembolso
              </h2>
              <p className="mt-3">
                Cancelar a assinatura impede a renovação automática. O acesso segue até o fim do período
                já pago. Cancelar <strong className="font-semibold text-slate-800">não</strong> estorna o
                ciclo corrente.
              </p>
              <p className="mt-3">
                Reembolso é um pedido separado, só nas hipóteses desta política, e só sobre cobrança já
                paga. Se quiser só parar de ser cobrado de novo, peça o cancelamento; se quiser o dinheiro
                da primeira cobrança de volta, peça o reembolso dentro do prazo.
              </p>
            </section>

            <section id="pix" className="scroll-mt-24">
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">7. Pagamentos via PIX</h2>
              <p className="mt-3">
                Quando a assinatura for paga via PIX pelo Stripe, o estorno também é iniciado no Stripe,
                de volta à mesma transação PIX. O crédito na conta do pagador pode levar de algumas horas
                a alguns dias úteis, conforme o banco. O prazo não é o mesmo do cartão e não depende só
                da nossa análise.
              </p>
            </section>

            <section id="contato-e-foro" className="scroll-mt-24">
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">8. Contato e foro</h2>
              <p className="mt-3">
                Dúvidas e pedidos:{" "}
                {supportMailto ? (
                  <a className="font-semibold text-emerald-700 hover:text-emerald-800" href={supportMailto}>
                    {company.supportEmail}
                  </a>
                ) : (
                  <span className="font-semibold text-slate-800">{company.supportEmail}</span>
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
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">9. Vigência</h2>
              <p className="mt-3">
                Versão vigente a partir de <strong className="font-semibold text-slate-800">{effectiveDateLabel}</strong>{" "}
                ({effectiveDateIso}). Alterações futuras passam a valer para novas cobranças a partir da
                data publicada nesta URL. Pedidos já abertos seguem a versão em vigor no dia do pedido.
              </p>
            </section>
          </div>
        </article>
      </main>

      <footer className="border-t border-slate-200 bg-slate-50 py-12">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-white">
                  N
                </span>
                <span className="text-sm font-bold uppercase tracking-wider text-slate-900">
                  Nex Gestão Vendas
                </span>
              </div>
              <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-500">
                Plataforma de vendas com PDV, estoque e gestão para o varejo.
              </p>
            </div>
            <nav aria-label="Links do rodapé" className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm">
              <Link href="/" className="text-slate-600 transition-colors hover:text-slate-900">
                Início
              </Link>
              <Link href="/#planos" className="text-slate-600 transition-colors hover:text-slate-900">
                Planos
              </Link>
              <Link href="/login" className="text-slate-600 transition-colors hover:text-slate-900">
                Login
              </Link>
              <Link href={REFUND_POLICY_PATH} className="text-slate-600 transition-colors hover:text-slate-900">
                Política de reembolso
              </Link>
            </nav>
          </div>
          <div className="mt-10 border-t border-slate-200 pt-6">
            <p className="text-xs text-slate-400">
              © {new Date().getUTCFullYear()} Nex Gestão Vendas. Todos os direitos reservados.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

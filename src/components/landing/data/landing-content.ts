/**
 * Conteúdo factual da landing — somente recursos e respostas comprovados no sistema.
 * Espelha dados de plans-sales-page.tsx sem duplicar lógica de negócio.
 */

export type LandingFeature = {
  id: string;
  title: string;
  description: string;
  /** Área do bento grid: a = grande, b/c = médios, d/e = pequenos */
  area: 'a' | 'b' | 'c' | 'd' | 'e';
};

export const LANDING_FEATURES: readonly LandingFeature[] = [
  {
    id: 'pdv',
    area: 'a',
    title: 'PDV offline-first',
    description:
      'Processe vendas no caixa mesmo sem internet. Ao reconectar, o sistema sincroniza automaticamente com a nuvem.',
  },
  {
    id: 'estoque',
    area: 'b',
    title: 'Estoque auditado',
    description:
      'Cada movimentação gera registro rastreável. Sem editar quantidade direto na tabela — histórico completo por SKU.',
  },
  {
    id: 'clientes',
    area: 'c',
    title: 'Cadastro de clientes',
    description: 'Consulte e vincule clientes às vendas em um cadastro centralizado na plataforma.',
  },
  {
    id: 'dashboard',
    area: 'd',
    title: 'Dashboard e relatórios',
    description:
      'Indicadores da operação, margem e desempenho por SKU — disponíveis no plano Enterprise.',
  },
  {
    id: 'pagamentos',
    area: 'e',
    title: 'Pagamentos no PDV',
    description:
      'Dinheiro, cartão e Pix via Mercado Pago no ponto de venda. Assinaturas do SaaS via Stripe.',
  },
];

export const LANDING_BENEFITS = [
  {
    title: 'Caixa que não para',
    description: 'O PDV continua operando offline. Vendas pendentes sincronizam quando a conexão volta.',
  },
  {
    title: 'Estoque sob controle',
    description: 'Movimentações auditadas evitam divergência entre prateleira e sistema.',
  },
  {
    title: 'Operação unificada',
    description: 'PDV, estoque, clientes e gestão no mesmo lugar — sem planilhas paralelas.',
  },
  {
    title: 'Multi-loja quando crescer',
    description: 'Planos de 1 a lojas ilimitadas, com recursos que escalam junto com o negócio.',
  },
] as const;

export type FaqItem = {
  question: string;
  answer: string;
  href?: string;
  linkLabel?: string;
};

export const LANDING_FAQ: readonly FaqItem[] = [
  {
    question: 'Qual a diferença entre os planos?',
    answer:
      'O Essencial é para uma loja com PDV, estoque e clientes. O Profissional amplia para até 3 lojas e traz hotkeys de caixa e StockMap. O Enterprise remove limites de lojas e inclui dashboard, relatórios e importação CSV de estoque.',
  },
  {
    question: 'Como funciona a cobrança?',
    answer:
      'A cobrança é recorrente — mensal ou anual, conforme o plano escolhido. O checkout online está disponível quando habilitado; você também pode falar com nosso time para assinar.',
  },
  {
    question: 'O que está incluso em cada plano?',
    answer:
      'Todos os planos incluem PDV offline-first, controle de estoque auditado e cadastro de clientes. Planos superiores adicionam hotkeys, StockMap, dashboard, relatórios e importação CSV.',
  },
  {
    question: 'Existe período de teste?',
    answer:
      'O Nex Gestão Vendas oferece assinaturas em diferentes status, incluindo trialing. Consulte as condições disponíveis na página de planos ou fale com nosso time.',
  },
  {
    question: 'Posso cancelar a assinatura?',
    answer:
      'Sim. O cancelamento evita a renovação; o acesso segue até o fim do período já pago. Cancelar não estorna o ciclo corrente.',
  },
  {
    question: 'Como funciona o reembolso?',
    answer:
      'Pedidos de estorno da primeira cobrança seguem prazo, uso em produção e as condições da política de reembolso.',
    href: '/politica-de-reembolso',
    linkLabel: 'Ler a Política de Reembolsos e Devoluções',
  },
];

export const TRUST_ITEMS = [
  {
    title: 'Dados protegidos',
    description: 'Conexão criptografada (HTTPS/TLS) e isolamento por organização na plataforma.',
  },
  {
    title: 'Operação offline',
    description: 'O PDV funciona sem internet e sincroniza quando a conexão retorna.',
  },
  {
    title: 'Suporte integrado',
    description: 'Canal de ajuda disponível diretamente na plataforma via assistente Anne.',
  },
] as const;

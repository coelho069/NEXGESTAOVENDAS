export const NAV_LINKS = [
  { href: "#inicio", label: "Início" },
  { href: "#recursos", label: "Recursos" },
  { href: "#planos", label: "Planos" },
  { href: "#beneficios", label: "Benefícios" },
  { href: "#faq", label: "FAQ" },
] as const;

export const HERO = {
  title: "Controle suas vendas, estoque e resultados em um só lugar.",
  subtitle:
    "PDV local-first, inventário auditado e dashboard de métricas para varejo brasileiro — do balcão ao fechamento, online ou offline.",
} as const;

export const PROBLEM_INTRO = {
  title: "Operação fragmentada trava o crescimento",
  subtitle: "Planilhas, sistemas desconectados e estoque impreciso geram retrabalho todos os dias.",
} as const;

export const PROBLEM_ITEMS = [
  {
    problem: "Caixa lento e fila",
    detail: "Busca manual de produtos, troco errado e perda de ritmo no pico de movimento.",
  },
  {
    problem: "Estoque desatualizado",
    detail: "Vender o que não tem, contagem manual e ajustes sem rastreabilidade.",
  },
  {
    problem: "Resultados no escuro",
    detail: "Fechamento demorado, margem incerta e decisões sem dados confiáveis.",
  },
] as const;

export const SOLUTION_INTRO = {
  title: "Nex Gestão Vendas centraliza a operação",
  subtitle: "Um sistema integrado para vender, controlar estoque e acompanhar resultados com segurança.",
} as const;

export const FEATURES = [
  {
    title: "PDV",
    description:
      "Ponto de venda com busca, scanner HID, carrinho local e sync offline. Pagamentos em dinheiro, PIX manual e voucher.",
  },
  {
    title: "Estoque",
    description:
      "Saldo auditado por movimentações — vendas, ajustes e reposição com motivo e papel do operador registrados.",
  },
  {
    title: "Inventário",
    description:
      "Ajustes controlados e importação CSV de movimentações, com relatório de erros por linha.",
  },
  {
    title: "Dashboard",
    description:
      "Métricas de receita, ticket médio, COGS, margem e sell-through por SKU — com exportação para análise.",
  },
  {
    title: "Clientes e produtos",
    description: "Cadastro de clientes, catálogo de produtos e histórico de vendas integrados ao PDV.",
  },
  {
    title: "Controle de acesso",
    description:
      "Papéis owner, manager e cashier — caixa não altera preço/custo nem acessa relatórios sensíveis.",
  },
] as const;

export const HOW_IT_WORKS_STEPS = [
  {
    step: "1",
    title: "Cadastre sua loja",
    description: "Crie sua conta, configure usuários e importe produtos e clientes.",
  },
  {
    step: "2",
    title: "Venda e controle estoque",
    description: "Use o PDV no balcão; cada venda atualiza o estoque de forma auditada.",
  },
  {
    step: "3",
    title: "Acompanhe resultados",
    description: "Consulte o dashboard para entender receita, margem e itens críticos.",
  },
] as const;

export const BENEFITS = [
  {
    title: "Menos retrabalho no caixa",
    description: "Fluxo pensado para balcão: busca rápida, hotkeys e recibo imediato.",
  },
  {
    title: "Estoque confiável",
    description: "Movimentações rastreáveis reduzem surpresas no inventário e no fechamento.",
  },
  {
    title: "Decisões com dados",
    description: "Dashboard com métricas reais da operação — sem planilhas paralelas.",
  },
  {
    title: "Funciona offline",
    description: "Vendas em dinheiro continuam mesmo sem internet; sync automático ao reconectar.",
  },
] as const;

export const DEMO_MOCKS = [
  { id: "pdv", title: "PDV", caption: "Carrinho, pagamentos e sync" },
  { id: "produtos", title: "Produtos", caption: "Catálogo e preços" },
  { id: "estoque", title: "Estoque", caption: "Saldos e movimentações" },
  { id: "dashboard", title: "Dashboard", caption: "Receita, margem e KPIs" },
] as const;

/** Shared product modules — same for all published price tiers (no per-plan entitlements in DB). */
export const SHARED_PLAN_FEATURES = [
  "PDV offline-first com sync automático",
  "Controle de estoque e inventário auditado",
  "Clientes, produtos e dashboard de métricas",
  "Controle de acesso por papéis (owner, manager, cashier)",
] as const;

export const PLANS_PARITY_NOTE =
  "Todos os planos publicados incluem os mesmos módulos do produto (PDV, estoque, clientes, produtos, dashboard e controle de acesso). A diferença entre planos está nos termos comerciais publicados — preço, descrição e condições de suporte ou contrato.";

export const FAQ_ITEMS = [
  {
    question: "O PDV funciona offline?",
    answer:
      "Sim. O Nex Gestão Vendas é local-first: vendas podem ser registradas offline e sincronizadas quando a conexão voltar, com replay idempotente por loja.",
  },
  {
    question: "Quais formas de pagamento estão disponíveis no PDV?",
    answer:
      "O PDV processa vendas em dinheiro, PIX manual e voucher. Cartão e PIX integrado dependem de configuração futura da assinatura.",
  },
  {
    question: "Como funciona o controle de estoque?",
    answer:
      "Quantidades não são editadas diretamente na tabela. Toda alteração passa por movimentações auditadas (venda, ajuste, reposição) com motivo e papel do operador.",
  },
  {
    question: "Quem pode ver o dashboard e relatórios?",
    answer:
      "Owner e manager têm acesso a métricas e exportações. Cashier opera o PDV e inventário, sem acesso a relatórios financeiros.",
  },
  {
    question: "Como contrato um plano?",
    answer:
      "Escolha o plano abaixo. Quando o checkout online estiver disponível, você poderá assinar diretamente; enquanto isso, fale conosco pelo WhatsApp.",
  },
] as const;

# Design System: Nex Gestão Vendas — Landing Pública

**Escopo:** landing comercial (`/` → `src/components/marketing/plans-sales-page.tsx`) e tokens globais (`src/app/globals.css`, `tailwind.config.ts`).

## 1. Visual Theme & Atmosphere

Clean e arejado ("airy"), SaaS B2B de varejo. Superfícies brancas sobre fundo levemente acinzentado, acentos verde-esmeralda transmitindo confiança financeira, painéis escuros (quase-preto) para contraste editorial. Densidade baixa a média: bastante respiro entre seções, componentes compactos. Cantos generosamente arredondados, sombras suaves e difusas — nunca duras. Estrutura de confiança: badge de pílula no topo do hero, mockup ilustrativo do produto em janela com "três bolinhas", prova por recursos reais (sem inventar funcionalidades).

## 2. Color Palette & Roles

- **Verde Ação Confiança (Emerald 600, `#059669`)** — CTAs primários ("Começar agora", "Abrir PDV"), links de ação, ícones de benefícios. Hover: Emerald 700 (`#047857`).
- **Quase-Preto Editorial (Slate 900, `#0f172a`)** — texto de títulos, painéis de destaque (card "Mais popular", banner "A solução", blocos de mockup).
- **Branco Superfície (`#ffffff`)** — cards, header translúcido (`bg-white/90` + `backdrop-blur`), fundo geral alternado.
- **Cinza Nevoeiro (Slate 50, `#f8fafc`)** — fundo de seções alternadas (Recursos, Planos, FAQ, Footer).
- **Cinza Texto Secundário (Slate 600, `#475569`)** — parágrafos, itens de lista, labels de navegação.
- **Borda Discreta (Slate 200, `#e2e8f0`)** — contornos de cards, divisórias do header/footer.
- **Esmeralda Neon (Emerald 300/400, `#6ee7b7`/`#34d399`)** — textos de destaque sobre painéis escuros.
- **Vermelho Dor (`#e11d48`/rose)** — exclusivo dos ícones da seção "Problemas" (dor do cliente).

Regra: verde = ação/positivo; escuro = ênfase editorial; vermelho = apenas dor do problema; nunca depender só de cor (sempre pairar texto + ícone).

## 3. Typography Rules

Família única: **Inter** (400/500/600/700) via `next/font`, classe `__className_37ef13` no `<body>`. Números com `tabular-nums` (preços, tabelas).

- **H1 (hero):** 36→48px responsivo, `font-bold`, `leading-[1.1]`, `tracking-tight` (hero usa `text-[3.4rem]` em `lg`).
- **H2 (seções):** 30px, `sm:text-4xl`, `font-bold tracking-tight`, centrado.
- **H3 (cards):** 16–18px, `font-semibold`.
- **Body:** 14px (`text-sm`) com `leading-relaxed`; intros 16px (`text-base`).
- **Micro-labels:** 12px, `uppercase`, `tracking-wide`/`tracking-[0.2em]`, `font-semibold`.
- **Preços:** 36px `font-bold tabular-nums` + sufixo de período em 14px `text-slate-500`.

## 4. Component Stylings

- **Botão primário:** pílula suave (`rounded-xl`, 8–12px), fundo Emerald 600, texto branco 14–16px `font-semibold`, sombra colorida difusa (`shadow-emerald-600/25`), hover escurece + sombra cresce, `active:scale-[0.98]`, `focus-visible:ring` acessível.
- **Botão secundário:** mesmo raio, contorno Slate 300 sobre branco (ou contorno branco translúcido sobre painel escuro), hover eleva borda/fundo.
- **Header:** sticky, 64px, fundo branco 90% + `backdrop-blur`, borda inferior fina; logo quadrado arredondado escuro com "N"; nav com âncoras (`#recursos`, `#como-funciona`, `#planos`, `#faq`); menu hambúrguer `< lg`.
- **Cards:** cantos muito arredondados (`rounded-2xl`/`rounded-3xl`), fundo branco, borda Slate 200, sombra sutil (`shadow-sm`) que cresce no hover (`hover:shadow-md`); ícone em quadrilhas arredondadas coloridas (Emerald 50 + Emerald 600; Rose para problemas).
- **Card "Mais popular":** fundo Slate 900, anel esmeralda (`ring-1 ring-emerald-500/40`), badge de pílula esmeralda flutuante no topo central, elevação maior (`lg:-translate-y-3`).
- **Estado desabilitado (checkout off):** pílula cinza com texto Slate 400, `cursor-not-allowed`, `aria-disabled`, rótulo honesto "Em breve".
- **FAQ:** acordeões `rounded-2xl` com borda que acende em esmeralda quando aberto, `ChevronDown` rotativo, `aria-expanded` correto.

## 5. Layout Principles

Container central único `max-w-6xl` com padding lateral 16/24px. Seções em `py-16 → sm:py-24` (64→96px), alternando fundo branco e Slate 50. Grids responsivos: recursos `1 → 2 → 3 → 4 colunas` (sm/lg/xl), planos `1 → 3 colunas`, problemas e passos `1 → 3 colunas`. Gaps de 20–32px. Âncoras com `scroll-mt-24` para compensar header sticky. Hierarquia por contraste de superfície (branco/nevoeiro/escuro) em vez de linhas divisórias.

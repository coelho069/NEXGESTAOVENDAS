# PORTING.md — Landing NexGestão (kit portável)

Landing page de conversão do **NexGestão** gerada a partir do `style_guide` +
`layout` (JSON de spec): tema escuro B2B SaaS, Glassmorphism, Bento Grid,
calculadora de ROI e prova social.

Este diretório é **portável e self-contained** (React + TypeScript + estilos
inline via tokens + `<style>` local para hover/mídia). Nenhuma dependência
além de React. Nenhum dado real de cliente, preço ou CNPJ foi incluído.

## Como montar

1. Copie a pasta para `src/components/landing/`.
2. Monte em `src/app/page.tsx`:

   ```tsx
   import { LandingPage } from '@/components/landing/LandingPage';

   export default function Page() {
     return <LandingPage />;
   }
   ```

3. Metadata de SEO (a `page.tsx` pode exportar):

   ```ts
   export const metadata = {
     title: 'NexGestão — CRM para escalar pipelines e fechar vendas',
     description:
       'Centralize leads, automatize follow-ups via WhatsApp e veja métricas de conversão em tempo real. 14 dias grátis, sem cartão.',
   };
   ```

A navbar é `position: fixed` e a landing assume o fundo escuro da página
inteira (`#0B0F19`) — monte-a como página raiz dedicada, não dentro de um
layout claro existente.

## Mapa

```
portable/landing/
├── LandingPage.tsx            # composição das seções + fontes + âncoras
├── PORTING.md
├── theme/landing-theme.ts     # tokens do style_guide (cores, fontes, raios, sombras)
└── components/
    ├── Navbar.tsx             # header flutuante glassmorphism (blur 16px)
    ├── HeroSection.tsx        # gradiente radial, dual CTA, mockup isométrico
    ├── BentoFeatures.tsx      # bento 6 colunas (areas a–e), score dinâmico
    ├── RoiCalculator.tsx      # sliders com trilha #10B981 + resultados tabulares
    ├── SocialProof.tsx        # métricas, depoimentos, selos LGPD/E2E/backup
    ├── FinalCtaBanner.tsx     # borda gradiente #2563EB→#10B981 + mesh interno
    └── Footer.tsx             # hairline, slate-400, status pulsante
```

## Placeholders obrigatórios antes de publicar

| Onde                         | O quê                                                            |
| ---------------------------- | ---------------------------------------------------------------- |
| `FinalCtaBanner.tsx`         | `WHATSAPP_URL` — trocar `'#'` pelo `wa.me` real                  |
| `Footer.tsx`                 | CNPJ fictício `00.000.000/0001-00` e links legais (`'#'`)        |
| `HeroSection.tsx`            | Envio do e-mail é validação local apenas — ligar no endpoint real |
| `Navbar.tsx` / links âncora  | `#recursos`, `#roi`, `#cases`, `#comecar` (já mapeados)          |
| Métricas e depoimentos       | Copy de demonstração — substituir por dados/cases reais          |

## Decisões da spec implementadas

- **Navbar**: `rgba(15,23,42,0.75)` + `blur(16px)` + border-bottom
  `rgba(255,255,255,0.08)`; links somem < 1000px, "Entrar" some < 620px.
- **Hero**: gradiente radial `#2563EB` ~12–14% no topo; mockup em
  `perspective(1600px) rotateX(12°) rotateY(-6°)` (CSS puro, vira flat
  < 760px), borda luminosa `0 0 50px -10px rgba(37,99,235,.35)` e reflexo
  `linear-gradient(180deg, rgba(255,255,255,0.1) 0%, transparent 100%)`.
- **Bento**: gap 24px; áreas `"a a a a b b" / "a a a a c c" / "d d e e e e"`;
  hover `scale(1.02)` + glow perimetral (apenas com `hover: hover`).
- **ROI**: painel `rgba(30,41,59,0.6)` + `blur(20px)`; sliders com trilha em
  `#10B981`; resultados em `tabular-nums`; premissas visíveis no card.
- **Cases**: sombras `0 20px 40px -15px rgba(0,0,0,0.5)`; selos cinza → cor
  no hover.
- **Banner final**: borda gradiente (padding 1.5px) + mesh com inset shadow;
  CTA branco (máximo contraste luminoso).
- **Footer**: hairline `rgba(255,255,255,0.05)`, slate-400 `#94A3B8`,
  sublinhado animado nos links, status verde pulsante.

## Fontes

As fontes do guide (Plus Jakarta Sans + Inter) são servidas pelo host via
`next/font` em `src/app/page.tsx`, que expõe `--font-jakarta` / `--font-inter`;
`theme/landing-theme.ts` consome essas variáveis. Não reative `@import` do
Google Fonts — a CSP de produção (`style-src 'self'` / `font-src 'self' data:`)
bloqueia o import e os woff2 externos.

## Integração em produção (este host)

Montada na raiz `src/app/page.tsx` (`<LandingPage />`). A página de
planos/assinaturas que antes ocupava `/` foi movida para `src/app/planos`.
CTAs internos apontam para rotas reais: *Entrar na Conta* → `/login`;
*Testar Gratuitamente* / *Destravar essa eficiência* / *Criar Conta Gratuita*
→ `/planos`. Permanecem como placeholder (documentados): `WHATSAPP_URL` (`'#'`),
CNPJ no footer e os links legais — não publicar dado fictício sem valor real.

# PORTING.md — Landing Nex Gestão Vendas

Landing de conversão do **Nex Gestão Vendas** (PDV, estoque, clientes). Tema escuro
B2B SaaS com tokens em `landing-theme.ts`, conteúdo factual em `data/landing-content.ts`.

Self-contained: React + TypeScript + estilos inline. Fontes via `next/font` no host
(sem `@import` — compatível com CSP de produção).

## Como montar

1. Copie a pasta para `src/components/landing/`.
2. Monte em `src/app/page.tsx` com `<LandingPage />` e fontes `Inter` + `Plus Jakarta Sans`.
3. Metadata de SEO em `page.tsx` (título/descrição do PDV).

## Mapa (produção)

```
src/components/landing/
├── LandingPage.tsx
├── data/landing-content.ts    # features, benefícios, FAQ, confiança
├── hooks/useReducedMotion.ts
├── theme/landing-theme.ts
└── components/
    ├── Navbar.tsx             # glassmorphism + menu mobile
    ├── HeroSection.tsx        # proposta de valor + mockup PDV
    ├── BenefitsSection.tsx    # benefícios para o comerciante
    ├── BentoFeatures.tsx      # funcionalidades reais (bento grid)
    ├── ProductDemo.tsx        # demonstração visual CSS
    ├── PlansPreview.tsx       # prévia de tiers → /planos
    ├── TrustSection.tsx       # segurança e suporte verificáveis
    ├── FaqSection.tsx         # accordion acessível
    ├── FinalCtaBanner.tsx
    ├── Footer.tsx
    └── Reveal.tsx             # animação ao rolar (prefers-reduced-motion)
```

Arquivos legados do kit original (não usados na composição atual):
`RoiCalculator.tsx`, `SocialProof.tsx`.

## CTAs e rotas

| Elemento | Destino |
| --- | --- |
| Entrar na Conta | `/login` |
| Começar agora / Criar Conta / Testar 14 dias | `/planos` |
| Ver planos e preços | `/planos` |
| Política de reembolso | `/politica-de-reembolso` |

Âncoras: `#recursos`, `#beneficios`, `#demo`, `#planos`, `#confianca`, `#faq`, `#comecar`.

## Integração em produção

- Raiz `/` → `<LandingPage />`; planos completos em `/planos`.
- Suporte via Anne (FAB global) — sem link WhatsApp morto no banner.
- Footer sem CNPJ fictício; links legais reais onde existem.
- Nenhuma dependência npm adicional para animações.

/**
 * Landing NexGestão — Design Tokens (Dark B2B SaaS) · style guide
 * -----------------------------------------------------------------------------
 * Fonte única de verdade visual da landing page. Todos os valores vêm do
 * style_guide (colors/typography/border_radius) — não inventar tokens paralelos.
 *
 * UX aplicada:
 *  - Fundo #0B0F19 com superfícies #1E293B: dados "flutuam" e o acento
 *    esmeralda (#10B981) reserva-se a CTA/resultado — hierarquia de conversão.
 *  - Números de resultado SEMPRE tabulares (`tabular-nums`): o card de ROI
 *    atualiza a cada movimento de slider sem "pular" layout.
 *  - Raios em 16px (base do guide) e 24px p/ painéis grandes — mesmo gesto
 *    tátil do restante do produto.
 */

export const landingTheme = {
  color: {
    /** #0F172A — primary do guide (texto forte, mockup). */
    primary: '#0F172A',
    /** #2563EB — secondary: ação/CTA azul. */
    secondary: '#2563EB',
    /** #10B981 — accent: CTA de conversão e resultados. */
    accent: '#10B981',
    /** #0B0F19 — background do guide. */
    bg: '#0B0F19',
    /** #1E293B — surface do guide. */
    surface: '#1E293B',
    /** Texto de títulos. */
    text: '#F1F5F9',
    /** Texto de corpo. */
    textBody: '#CBD5E1',
    /** Texto de apoio/footer (slate-400 do guide). */
    textMuted: '#94A3B8',
    /** Bordas finas com iluminação direcional (bento). */
    border: 'rgba(255, 255, 255, 0.06)',
    /** Bordas de glass/inputs. */
    borderStrong: 'rgba(255, 255, 255, 0.10)',
    /** Navbar flutuante em glassmorphism fosco. */
    glassBg: 'rgba(15, 23, 42, 0.75)',
    glassBorder: 'rgba(255, 255, 255, 0.08)',
    /** Painel da calculadora de ROI. */
    roiPanelBg: 'rgba(30, 41, 59, 0.6)',
    /** Texto sobre o accent (contraste AA garantido no verde). */
    accentText: '#04231A',
  },

  font: {
    /** Títulos/display (guide: Plus Jakarta Sans). */
    heading: '"Plus Jakarta Sans", "Inter", system-ui, sans-serif',
    /** Corpo (guide: Inter). */
    body: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },

  radius: {
    md: '12px',
    /** Base do guide: 16px. */
    lg: '16px',
    /** Painéis grandes (ROI, banner final). */
    xl: '24px',
    full: '9999px',
  },

  shadow: {
    /** Borda luminosa do mockup central do hero (spec). */
    heroGlow: '0 0 50px -10px rgba(37, 99, 235, 0.35)',
    /** Cards de prova social (spec: sombra difusa). */
    card: '0 20px 40px -15px rgba(0, 0, 0, 0.5)',
    /** Glow perimetral de hover no bento. */
    bentoHover:
      '0 0 0 1px rgba(37, 99, 235, 0.22), 0 24px 48px -16px rgba(37, 99, 235, 0.35)',
    /** Glow de CTA primário. */
    ctaGlow: '0 12px 32px -8px rgba(37, 99, 235, 0.55)',
    ctaAccentGlow: '0 12px 32px -8px rgba(16, 185, 129, 0.45)',
  },

  motion: {
    fast: '150ms',
    base: '220ms',
  },

  layout: {
    /** Largura máxima do conteúdo. */
    max: '1180px',
    /** Gap do Bento Grid (spec: 24px). */
    bentoGap: '24px',
    /** Altura visual da navbar flutuante (p/ scroll-margin das âncoras). */
    navClearance: '96px',
  },
} as const;

export type LandingTheme = typeof landingTheme;

/** Classe/estilo utilitário p/ TODA cifra (ROI, métricas, mockup). */
export const tabularNums = {
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: '"tnum"',
} as const;

/** BRL inteiro (estimativas da landing não usam centavos). */
export const brl = (valor: number): string =>
  valor.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  });

/** Import das fontes do guide (Plus Jakarta Sans + Inter). */
export const FONT_IMPORT =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap";

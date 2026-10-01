/**
 * PDV — Design Tokens (Escuro Industrial) · spec v2
 * -----------------------------------------------------------------------------
 * Fonte única de verdade visual da tela operacional do PDV.
 *
 * UX aplicada:
 *  - Base #0B0E11: reduz glare em balcão com luz variável; conteúdo "flutua"
 *    sobre superfícies discretas (surface → surface_alt).
 *  - Todos os pares texto/fundo cumprem WCAG AA (>= 4.5:1; >= 3:1 p/ grande).
 *  - Alvos de toque CODIFICADOS como tokens (touch_matrix da spec): min 44,
 *    linha do cupom 52, pagamento 56, tecla do numpad 64, atalho 96 —
 *    impossível criar um controle abaixo do mínimo ergonômico.
 *  - Números SEMPRE tabulares (`tabular-nums`): dígitos de largura fixa,
 *    sem "saltos" no Total durante a digitação.
 */

export const pdvTheme = {
  color: {
    /** Fundo base da tela (Escuro Industrial — spec). */
    bg: '#0B0E11',
    /** Painéis/cupom. */
    surface: '#14181D',
    /** Elementos elevados: sheet, teclas, dropdown, ativo. */
    surfaceAlt: '#1C2229',
    /** Linhas/divisórias. */
    border: '#2A323C',
    /** Bordas de destaque (botões secundários da sheet). */
    borderStrong: '#3D4754',
    /** Texto primário. */
    text: '#E8EEF2',
    /** Texto de apoio (SKUs, labels). */
    textMuted: '#8B97A3',
    /** Ação primária/foco (ciano alto contraste no escuro). */
    accent: '#00E5FF',
    /** Texto SOBRE o accent (contraste AA garantido). */
    accentText: '#041316',
    /** Destrutivo: remoção, código não encontrado. */
    danger: '#FF3B5C',
    /** Positivo: confirmar, ONLINE. */
    success: '#3DDC97',
  },

  radius: {
    /** Botões e inputs. */
    md: '8px',
    /** Painéis, cartões de atalho. */
    lg: '12px',
    /** Sheet de pagamento e Total em destaque. */
    xl: '16px',
    /** Badge circular. */
    full: '9999px',
  },

  font: {
    sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    /** Stack numérica da spec: monoespaçada + tabular-nums. */
    mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    /** Total a Pagar: maior elemento da tela (56px — spec). */
    totalSize: '56px',
    totalWeight: 800,
    /** Linha de item: legível a 1 metro, em pé. */
    rowNameSize: '15px',
    rowPriceSize: '17px',
    /** Legenda de atalhos (F2/F4…). */
    kbdSize: '11px',
  },

  /**
   * Touch matrix da spec (px):
   *  min 44 · linha do cupom 52 · pagamento 56 · tecla numpad 64 · atalho 96.
   */
  touch: {
    min: 44,
    row: 52,
    pay: 56,
    numpad: 64,
    shortcut: 96,
  },

  /** Sombras discretas — só p/ elevar sheet/dropdown. */
  shadow: {
    sheet: '0 -16px 48px rgba(0,0,0,0.55)',
    dropdown: '0 12px 32px rgba(0,0,0,0.5)',
  },

  /** Durações curtas: feedback perceptível, nunca "dançante". */
  motion: {
    instant: '60ms',
    fast: '140ms',
  },
} as const;

export type PdvTheme = typeof pdvTheme;

/** Classe/estilo utilitário p/ TODA cifra monetária e quantidade. */
export const tabularNums = {
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: '"tnum"',
} as const;

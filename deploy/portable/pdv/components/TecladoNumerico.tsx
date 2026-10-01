/**
 * TecladoNumerico — entrada rápida de valores por toque (spec v2).
 * -----------------------------------------------------------------------------
 * UX aplicada:
 *  - Layout de caixa registradora (7-8-9 em cima) — memória muscular de
 *    maquininha/registradora, zero curva de aprendizado.
 *  - Teclas de 64px (touch_matrix da spec): digitação com um dedo, sem olhar.
 *  - Modelo "dígitos = centavos" (spec: digits_as_cents, comma_enabled:
 *    FALSE): digitar 4 9 9 = R$ 4,99. NÃO EXISTE vírgula para errar.
 *  - Corrigir é 1 toque (⌫); limpar é 1 toque (C).
 */

'use client';

import { pdvTheme as t } from '../theme/pdv-theme';
import { centavosDeDigitos, formatarCentavos } from '../lib/money';

interface Props {
  digitos: string;
  onDigito: (d: string) => void;
  onBackspace: () => void;
  onLimpar: () => void;
  /** Prévia formatada do valor digitado (centavos). */
  valorCentavos: number;
}

const TECLAS: Array<{ rotulo: string; acao: (o: Omit<Props, 'valorCentavos'>) => void }> = [
  { rotulo: '7', acao: (o) => o.onDigito('7') },
  { rotulo: '8', acao: (o) => o.onDigito('8') },
  { rotulo: '9', acao: (o) => o.onDigito('9') },
  { rotulo: 'C', acao: (o) => o.onLimpar() },
  { rotulo: '4', acao: (o) => o.onDigito('4') },
  { rotulo: '5', acao: (o) => o.onDigito('5') },
  { rotulo: '6', acao: (o) => o.onDigito('6') },
  { rotulo: '⌫', acao: (o) => o.onBackspace() },
  { rotulo: '1', acao: (o) => o.onDigito('1') },
  { rotulo: '2', acao: (o) => o.onDigito('2') },
  { rotulo: '3', acao: (o) => o.onDigito('3') },
  { rotulo: '00', acao: (o) => o.onDigito('00') }, // reais inteiros rápidos
];

export function TecladoNumerico({ valorCentavos, ...acoes }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Display do valor sendo digitado — tabular, gigante, inconfundível */}
      <div
        aria-live="polite"
        style={{
          minHeight: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          padding: '0 18px',
          backgroundColor: t.color.bg,
          border: `1px solid ${t.color.border}`, // spec: #2A323C
          borderRadius: t.radius.lg,
          fontSize: 32,
          fontWeight: 800,
          ...TABULAR,
          color: valorCentavos > 0 ? t.color.text : t.color.textMuted,
        }}
      >
        {formatarCentavos(valorCentavos)}
      </div>

      <div
        role="group"
        aria-label="Teclado numérico"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
        }}
      >
        {TECLAS.map(({ rotulo, acao }) => (
          <button
            key={rotulo}
            type="button"
            onClick={() => acao(acoes)}
            style={{
              minHeight: t.touch.numpad, // 64px — spec
              border: `1px solid ${t.color.border}`,
              borderRadius: t.radius.md,
              backgroundColor: t.color.surfaceAlt, // spec: #1C2229
              color: rotulo === 'C' ? t.color.danger : t.color.text,
              fontSize: 22,
              fontWeight: 700,
              cursor: 'pointer',
              transition: `background-color ${t.motion.instant}`,
            }}
          >
            {rotulo}
          </button>
        ))}
        {/* 0 full-row (spec: comma_enabled=false) — alvo enorme */}
        <button
          type="button"
          onClick={() => acoes.onDigito('0')}
          style={{
            gridColumn: '1 / -1',
            minHeight: t.touch.numpad,
            border: `1px solid ${t.color.border}`,
            borderRadius: t.radius.md,
            backgroundColor: t.color.surfaceAlt,
            color: t.color.text,
            fontSize: 22,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          0
        </button>
      </div>
    </div>
  );
}

const TABULAR: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: '"tnum"',
};

// Reexport p/ a Sheet calcular dígitos -> centavos sem importar money.ts.
export { centavosDeDigitos };

/**
 * GradeAtalhos — produtos frequentes a 1 toque (PRD step_2).
 * -----------------------------------------------------------------------------
 * UX aplicada:
 *  - Grid 4 colunas (tablet em pé) com cartões ≥ 96px de altura: alvo de toque
 *    muito acima do mínimo de 44px — erro de toque é quase impossível.
 *  - F4 move o foco para cá; Tab navega entre cartões (ordem do DOM = ordem
 *    visual, sem surpresas).
 *  - Nome com no máx. 2 linhas + SKU pequeno + preço em tabular-nums: leitura
 *    a 1 metro de distância, em pé.
 *  - Pressionado usa `color.surfaceAlt` p/ feedback tátil imediato.
 */

'use client';

import { pdvTheme as t } from '../theme/pdv-theme';
import { formatarBRL } from '../lib/money';
import type { Produto } from '../lib/types';

interface Props {
  produtos: Produto[];
  onAdicionar: (produto: Produto) => void;
}

export function GradeAtalhos({ produtos, onAdicionar }: Props) {
  if (produtos.length === 0) {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 10,
        }}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            aria-hidden
            style={{
              height: 96,
              borderRadius: t.radius.lg,
              backgroundColor: t.color.surface,
              border: `1px dashed ${t.color.border}`,
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: 10,
      }}
    >
      {produtos.slice(0, 12).map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onAdicionar(p)}
          aria-label={`Adicionar ${p.name}, ${formatarBRL(p.unit_price)}`}
          style={{
            minHeight: 96,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            padding: '10px 12px',
            backgroundColor: t.color.surface,
            border: `1px solid ${t.color.border}`,
            borderRadius: t.radius.lg,
            color: t.color.text,
            textAlign: 'left',
            cursor: 'pointer',
            transition: `background-color ${t.motion.instant}, border-color ${t.motion.instant}`,
          }}
          // Feedback de "afundou" sem esper por CSS-in-JS dinâmico
          onMouseDown={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = t.color.surfaceAlt;
          }}
          onMouseUp={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = t.color.surface;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = t.color.surface;
          }}
        >
          <span
            style={{
              fontSize: t.font.rowNameSize,
              fontWeight: 600,
              lineHeight: 1.25,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {p.name}
          </span>
          <span
            style={{
              display: 'flex',
              width: '100%',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <span style={{ fontSize: 11, color: t.color.textMuted }}>{p.sku ?? '—'}</span>
            <span
              style={{
                ...TABULAR,
                fontSize: 15,
                fontWeight: 700,
                color: t.color.text,
              }}
            >
              {formatarBRL(p.unit_price)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Dígitos de largura fixa — preços nunca "dançam" ao atualizar. */
const TABULAR: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: '"tnum"',
};

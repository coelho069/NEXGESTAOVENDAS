/**
 * ListaCupom — o "cupom fiscal em construção" (PRD step_2).
 * -----------------------------------------------------------------------------
 * UX aplicada:
 *  - Linhas de 52px (faixa 48–56 do PRD): densidade boa + alvo de toque OK.
 *  - Quantidade INLINE com botões − / + (44px cada): editar qty é 1 toque,
 *    sem modal. Decrementar para na unidade 1; remover é gesto separado
 *    (lixeira) — evita apagar item por toque acidental.
 *  - Valores em tabular-nums alinhados à direita: coluna de preços forma uma
 *    régua visual — erro de leitura praticamente zero.
 *  - F8 foca a lista; cada linha é focável (Tab) e remove com Delete.
 */

'use client';

import { pdvTheme as t } from '../theme/pdv-theme';
import { formatarBRL } from '../lib/money';
import { totalLinhaCentavos, formatarCentavos } from '../lib/money';
import type { LinhaCupom } from '../lib/types';

interface Props {
  linhas: LinhaCupom[];
  onIncrementar: (produtoId: string) => void;
  onDecrementar: (produtoId: string) => void;
  onRemover: (produtoId: string) => void;
  /** F9 "cancelar item": a tela precisa saber qual linha está mirada. */
  onFocarLinha?: (produtoId: string | null) => void;
  idLinhaFocada?: string | null;
}

export function ListaCupom({
  linhas,
  onIncrementar,
  onDecrementar,
  onRemover,
  onFocarLinha,
  idLinhaFocada,
}: Props) {
  if (linhas.length === 0) {
    return (
      <div
        style={{
          minHeight: 120,
          display: 'grid',
          placeItems: 'center',
          border: `1px dashed ${t.color.border}`,
          borderRadius: t.radius.lg,
          color: t.color.textMuted,
          fontSize: 14,
          textAlign: 'center',
          padding: 16,
        }}
      >
        Cupom vazio — bipe um código ou toque em um atalho.
        <span style={{ fontSize: 12, marginTop: 4 }}>
          <Kbd>F2</Kbd> busca · <Kbd>F4</Kbd> quantidade · <Kbd>F9</Kbd> cancelar item · <Kbd>F12</Kbd> finalizar
        </span>
      </div>
    );
  }

  return (
    <ul style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: 0, padding: 0, listStyle: 'none' }}>
      {linhas.map((l) => {
        const subtotal = totalLinhaCentavos(l.produto.unit_price, l.quantidade);
        const mirada = idLinhaFocada === l.produto.id;
        return (
          <li
            key={l.produto.id}
            tabIndex={0}
            onFocus={() => onFocarLinha?.(l.produto.id)}
            onBlur={() => onFocarLinha?.(null)}
            onKeyDown={(ev) => {
              if (ev.key === 'Delete') {
                ev.preventDefault();
                onRemover(l.produto.id);
              }
            }}
            style={{
              minHeight: t.touch.row, // 52px — touch_matrix da spec
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '4px 10px',
              backgroundColor: mirada ? t.color.surfaceAlt : t.color.surface,
              border: `1px solid ${mirada ? t.color.accent : t.color.border}`,
              borderRadius: t.radius.md,
            }}
          >
            {/* Nome + SKU: a área "rica" da linha */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: t.font.rowNameSize,
                  fontWeight: 600,
                  color: t.color.text,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {l.produto.name}
              </div>
              <div style={{ fontSize: 11, color: t.color.textMuted }}>
                {l.produto.sku ?? l.produto.barcode ?? '—'} · {formatarBRL(l.produto.unit_price)} un.
              </div>
            </div>

            {/* Quantidade inline: − qty +  (alvos 44px, lado a lado) */}
            <div
              role="group"
              aria-label={`Quantidade de ${l.produto.name}`}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <QtdBotao
                label={`Diminuir ${l.produto.name}`}
                onClick={() => onDecrementar(l.produto.id)}
                disabled={l.quantidade <= 1}
              >
                −
              </QtdBotao>
              <span
                style={{
                  ...TABULAR,
                  minWidth: 34,
                  textAlign: 'center',
                  fontSize: 16,
                  fontWeight: 700,
                  color: t.color.text,
                }}
              >
                {l.quantidade}
              </span>
              <QtdBotao label={`Aumentar ${l.produto.name}`} onClick={() => onIncrementar(l.produto.id)}>
                +
              </QtdBotao>
            </div>

            {/* Subtotal da linha: régua de números à direita */}
            <span
              style={{
                ...TABULAR,
                width: 96,
                textAlign: 'right',
                fontSize: t.font.rowPriceSize,
                fontWeight: 700,
                color: t.color.text,
              }}
            >
              {formatarCentavos(subtotal)}
            </span>

            {/* Remoção explícita (fora do caminho do +/-) */}
            <button
              type="button"
              onClick={() => onRemover(l.produto.id)}
              aria-label={`Remover ${l.produto.name} do cupom`}
              style={{
                minWidth: 44,
                minHeight: 44,
                border: 'none',
                borderRadius: t.radius.md,
                background: 'transparent',
                color: t.color.textMuted,
                fontSize: 16,
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function QtdBotao({
  children,
  onClick,
  label,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        width: 44,
        height: 44,
        border: `1px solid ${t.color.textMuted}`,
        borderRadius: t.radius.md,
        backgroundColor: t.color.surfaceAlt,
        color: disabled ? t.color.textMuted : t.color.text,
        fontSize: 20,
        fontWeight: 700,
        lineHeight: 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        fontFamily: t.font.mono,
        fontSize: t.font.kbdSize,
        padding: '2px 6px',
        border: `1px solid ${t.color.textMuted}`,
        borderBottomWidth: 2,
        borderRadius: 4,
        color: t.color.text,
        backgroundColor: t.color.surfaceAlt,
      }}
    >
      {children}
    </kbd>
  );
}

const TABULAR: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: '"tnum"',
};

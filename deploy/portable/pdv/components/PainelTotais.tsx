/**
 * PainelTotais — hierarquia visual: Total a Pagar é O MAIOR elemento (spec).
 * -----------------------------------------------------------------------------
 * UX aplicada:
 *  - Total em 56px/800 tabular-nums: impossível não saber quanto é, de
 *    relance, a 1 metro, em pé.
 *  - F8 abre o MODO DESCONTO inline (spec: F8=Discount): input numérico
 *    pequeno, Enter confirma, Esc cancela — sem sheet nem modal.
 *  - Badge de conexão SEMPRE visível (spec): ONLINE em success #3DDC97,
 *    OFFLINE · N PENDENTES na mesma cor com ícone de alerta — o operador
 *    distingue pelo ÍCONE e pelo texto, não só pela cor (não só daltônico-
 *    safe: também é explícito no rótulo).
 *  - Botão "FINALIZAR (F12)" com 56px (payment_btn da spec).
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { pdvTheme as t } from '../theme/pdv-theme';
import { formatarCentavos, paraCentavos } from '../lib/money';
import type { EstadoConexao } from '../lib/types';

interface Props {
  subtotalCentavos: number;
  descontoCentavos: number;
  onAplicarDesconto: (centavos: number) => void;
  totalCentavos: number;
  totalItens: number;
  conexao: EstadoConexao;
  onFinalizar: () => void;
  onSincronizar: () => void;
}

export function PainelTotais({
  subtotalCentavos,
  descontoCentavos,
  onAplicarDesconto,
  totalCentavos,
  totalItens,
  conexao,
  onFinalizar,
  onSincronizar,
}: Props) {
  const offline = conexao.tipo === 'offline';
  const bloqueado = totalCentavos <= 0;

  // ---------------- MODO DESCONTO (F8) ----------------
  const [descontoAberto, setDescontoAberto] = useState(false);
  const [digitos, setDigitos] = useState('');
  const inputDescontoRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (descontoAberto) inputDescontoRef.current?.focus();
  }, [descontoAberto]);

  const confirmarDesconto = () => {
    // dígitos = centavos (mesmo modelo do numpad; "50" = R$ 0,50).
    onAplicarDesconto(Math.min(paraCentavos(999999), digitosParaCentavos(digitos)));
    setDigitos('');
    setDescontoAberto(false);
  };

  return (
    <section
      aria-label="Totais do cupom"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 16,
        backgroundColor: t.color.surface,
        border: `1px solid ${offline ? t.color.success : t.color.border}`,
        borderRadius: t.radius.xl,
      }}
    >
      {/* ---------------- Conexão (spec: ONLINE / OFFLINE · N PENDENTES) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        {conexao.tipo === 'online' && (
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: 0.4,
              color: t.color.success, // spec: ONLINE em #3DDC97
            }}
          >
            <Dot cor={t.color.success} /> ONLINE
          </span>
        )}
        {conexao.tipo === 'carregando' && (
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: 0.4,
              color: t.color.textMuted,
            }}
          >
            <Dot cor={t.color.textMuted} /> SINCRONIZANDO…
          </span>
        )}
        {offline && (
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: 0.4,
              color: t.color.success, // spec: offline_color #3DDC97
            }}
          >
            ⚠ OFFLINE · {offline ? conexao.pendentes : 0} PENDENTES
          </span>
        )}

        <button
          type="button"
          onClick={onSincronizar}
          aria-label="Reconsultar catálogo e conexão"
          style={{
            minHeight: t.touch.min,
            padding: '0 14px',
            border: `1px solid ${t.color.border}`,
            borderRadius: t.radius.md,
            background: t.color.surfaceAlt,
            color: t.color.textMuted,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Sincronizar <Kbd>F2</Kbd>
        </button>
      </div>

      {/* ---------------- Linhas de valores */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <LinhaRotulo
          rotulo={`${totalItens} ${totalItens === 1 ? 'item' : 'itens'}`}
          centavos={subtotalCentavos}
        />

        {/* Desconto: F8 abre inline; sempre clicável p/ conferir/zerar */}
        {descontoAberto ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: t.color.textMuted }}>
              Desconto R$
            </span>
            <input
              ref={inputDescontoRef}
              value={digitos}
              inputMode="numeric"
              onChange={(e) => setDigitos(e.target.value.replace(/\D/g, '').slice(0, 8))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  confirmarDesconto();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setDigitos('');
                  setDescontoAberto(false);
                }
              }}
              placeholder="0,00"
              style={{
                flex: 1,
                height: 44,
                backgroundColor: t.color.bg,
                border: `2px solid ${t.color.accent}`,
                borderRadius: t.radius.md,
                color: t.color.text,
                fontSize: 16,
                fontWeight: 700,
                ...TABULAR,
                padding: '0 10px',
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={confirmarDesconto}
              style={botaoMini}
            >
              OK
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDescontoAberto(true)}
            aria-label="Aplicar desconto (F8)"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              minHeight: 36,
              padding: '0 4px',
              background: 'transparent',
              border: 'none',
              color: descontoCentavos > 0 ? t.color.success : t.color.textMuted,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <span>Desconto {descontoCentavos > 0 ? '' : '(F8)'}</span>
            <span style={{ ...TABULAR }}>
              {descontoCentavos > 0 ? `− ${formatarCentavos(descontoCentavos)}` : '—'}
            </span>
          </button>
        )}
      </div>

      {/* ---------------- Total: maior elemento da tela */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: t.color.textMuted, marginBottom: 2 }}>
          TOTAL A PAGAR
        </div>
        <div
          aria-live="polite"
          aria-label={`Total a pagar ${formatarCentavos(totalCentavos)}`}
          style={{
            fontSize: t.font.totalSize, // 56px — spec
            lineHeight: 1.05,
            fontWeight: t.font.totalWeight,
            ...TABULAR,
            color: totalCentavos > 0 ? t.color.text : t.color.textMuted,
            letterSpacing: '-0.02em',
          }}
        >
          {formatarCentavos(totalCentavos)}
        </div>
      </div>

      {/* ---------------- CTA de finalização (56px — payment_btn) */}
      <button
        type="button"
        onClick={onFinalizar}
        disabled={bloqueado}
        style={{
          height: t.touch.pay,
          border: 'none',
          borderRadius: t.radius.lg,
          backgroundColor: bloqueado ? t.color.surfaceAlt : t.color.accent, // ciano da spec
          color: bloqueado ? t.color.textMuted : t.color.accentText, // texto escuro sobre ciano
          fontSize: 20,
          fontWeight: 800,
          letterSpacing: 0.2,
          cursor: bloqueado ? 'not-allowed' : 'pointer',
          transition: `background-color ${t.motion.fast}`,
        }}
      >
        FINALIZAR (F12)
      </button>
    </section>
  );
}

function digitosParaCentavos(digitos: string): number {
  const so = digitos.replace(/\D/g, '');
  return so === '' ? 0 : parseInt(so, 10);
}

function LinhaRotulo({ rotulo, centavos }: { rotulo: string; centavos: number }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: 13,
        fontWeight: 600,
        color: t.color.textMuted,
        ...TABULAR,
      }}
    >
      <span>{rotulo}</span>
      <span>{formatarCentavos(centavos)}</span>
    </div>
  );
}

function Dot({ cor }: { cor: string }) {
  return (
    <span
      aria-hidden
      style={{
        width: 8,
        height: 8,
        borderRadius: t.radius.full,
        backgroundColor: cor,
        display: 'inline-block',
      }}
    />
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        fontFamily: t.font.mono,
        fontSize: t.font.kbdSize,
        padding: '1px 5px',
        border: `1px solid ${t.color.border}`,
        borderRadius: 4,
        color: t.color.textMuted,
      }}
    >
      {children}
    </kbd>
  );
}

const botaoMini: React.CSSProperties = {
  minHeight: 44,
  padding: '0 16px',
  border: 'none',
  borderRadius: t.radius.md,
  backgroundColor: t.color.accent,
  color: t.color.accentText,
  fontSize: 14,
  fontWeight: 800,
  cursor: 'pointer',
};

const TABULAR: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: '"tnum"',
};

/**
 * SheetPagamento — checkout rápido com pagamentos MISTOS e troco (PRD step_2).
 * -----------------------------------------------------------------------------
 * UX aplicada:
 *  - Sheet inferior (não modal bloqueante visual): o cupom continua visível
 *    por trás — o caixa confere enquanto digita o valor recebido.
 *  - Pagamento misto em 2 toques por forma: escolher forma -> valor -> OK.
 *    Saldo restante sempre visível e gigante (tabular).
 *  - Troco calculado em centavos (inteiros) — nunca "R$ 0,30000000004".
 *  - Botão CONFIRMAR com 56px+ e habilitado SÓ quando saldo = 0 (impossível
 *    fechar a venda "errada" por toque).
 *  - Esc fecha; foco vai para o teclado ao abrir (PRD: F9 -> digitar -> Enter).
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { pdvTheme as t } from '../theme/pdv-theme';
import { formatarCentavos, centavosDeDigitos } from '../lib/money';
import type { FormaPagamento, Pagamento } from '../lib/types';
import { TecladoNumerico } from './TecladoNumerico';

interface Props {
  aberto: boolean;
  /** Total do cupom em centavos. */
  totalCentavos: number;
  /** Pagamentos já registrados nesta venda (mistos). */
  pagamentos: Pagamento[];
  /** total - pago; negativo após quitar = troco. */
  saldoCalculado: number;
  /** true enquanto o host processa a confirmação (evita duplo submit). */
  processando?: boolean;
  onRegistrarPagamento: (p: Pagamento) => void;
  onConfirmar: () => void;
  onFechar: () => void;
}

const FORMAS: Array<{ forma: FormaPagamento; rotulo: string }> = [
  { forma: 'DINHEIRO', rotulo: 'Dinheiro' },
  { forma: 'DEBITO', rotulo: 'Débito' },
  { forma: 'CREDITO', rotulo: 'Crédito' },
  { forma: 'PIX', rotulo: 'Pix' },
];

export function SheetPagamento({
  aberto,
  totalCentavos,
  pagamentos,
  saldoCalculado,
  processando = false,
  onRegistrarPagamento,
  onConfirmar,
  onFechar,
}: Props) {
  const [forma, setForma] = useState<FormaPagamento>('DINHEIRO');
  const [digitos, setDigitos] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);

  const digitosCentavos = centavosDeDigitos(digitos);
  // Regra de conveniência: valor zerado = "valor exato" da forma escolhida.
  const valorSugerido = Math.max(0, saldoCalculado);
  const valorCentavos = digitosCentavos > 0 ? digitosCentavos : valorSugerido;

  // Esc fecha o sheet; Enter registra/ confirma.
  useEffect(() => {
    if (!aberto) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onFechar();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [aberto, onFechar]);

  if (!aberto) return null;

  const quitar = () => {
    onRegistrarPagamento({ forma, centavos: valorCentavos });
    setDigitos('');
  };

  const todasQuitado = saldoCalculado <= 0 && pagamentos.length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pagamento"
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        backgroundColor: 'rgba(4, 6, 8, 0.66)',
      }}
    >
      <div
        style={{
          width: 'min(960px, 100%)',
          maxHeight: '92vh',
          overflowY: 'auto',
          backgroundColor: t.color.surfaceAlt,
          borderTop: `2px solid ${t.color.accent}`,
          borderTopLeftRadius: t.radius.xl,
          borderTopRightRadius: t.radius.xl,
          boxShadow: t.shadow.sheet,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* -------------------------------- Cabeçalho: números primeiro */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 10,
          }}
        >
          <Numero rotulo="Total" centavos={totalCentavos} destaque />
          <Numero rotulo="Pago" centavos={totalCentavos - saldoCalculado} />
          {/* saldo < 0 => já pagou demais => Troco (verde); senão Falta (âmbar) */}
          <Numero
            rotulo={saldoCalculado < 0 ? 'Troco' : 'Falta'}
            centavos={Math.abs(saldoCalculado)}
            cor={saldoCalculado < 0 ? t.color.success : t.color.danger}
          />
        </div>

        {/* -------------------------------- Formas de pagamento (56px) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {FORMAS.map(({ forma: f, rotulo }) => {
            const ativo = f === forma;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setForma(f)}
                aria-pressed={ativo}
                style={{
                  minHeight: t.touch.pay,
                  border: `2px solid ${ativo ? t.color.accent : t.color.border}`,
                  borderRadius: t.radius.lg,
                  backgroundColor: ativo ? t.color.surfaceAlt : t.color.surface,
                  color: t.color.text,
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {rotulo}
              </button>
            );
          })}
        </div>

        {/* -------------------------------- Valor + teclado */}
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: t.color.textMuted }}>
              Valor recebido ({forma})
            </div>
            <TecladoNumerico
              digitos={digitos}
              onDigito={(d) => setDigitos((atual) => (atual + d).slice(0, 9))}
              onBackspace={() => setDigitos((atual) => atual.slice(0, -1))}
              onLimpar={() => setDigitos('')}
              valorCentavos={valorCentavos}
            />
            <button
              type="button"
              onClick={quitar}
              disabled={valorCentavos <= 0}
              style={{
                minHeight: t.touch.pay,
                border: 'none',
                borderRadius: t.radius.lg,
                backgroundColor: valorCentavos > 0 ? t.color.accent : t.color.surfaceAlt,
                color: valorCentavos > 0 ? t.color.accentText : t.color.textMuted,
                fontSize: 17,
                fontWeight: 800,
                cursor: valorCentavos > 0 ? 'pointer' : 'not-allowed',
              }}
            >
              ADICIONAR PAGAMENTO
            </button>
          </div>

          {/* Lista de pagamentos registrados (misto) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: t.color.textMuted }}>
              Pagamentos desta venda
            </div>
            {pagamentos.length === 0 && (
              <div
                style={{
                  padding: 14,
                  border: `1px dashed ${t.color.border}`,
                  borderRadius: t.radius.lg,
                  color: t.color.textMuted,
                  fontSize: 14,
                }}
              >
                Nenhum ainda. Dica: deixe o valor zerado para registrar o valor exato.
              </div>
            )}
            {pagamentos.map((p, i) => (
              <div
                key={`${p.forma}-${i}`}
                style={{
                  minHeight: 48,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 14px',
                  backgroundColor: t.color.surface,
                  border: `1px solid ${t.color.border}`,
                  borderRadius: t.radius.md,
                  color: t.color.text,
                  fontSize: 15,
                  fontWeight: 600,
                }}
              >
                <span>{p.forma}</span>
                <span style={{ ...TABULAR, fontWeight: 700 }}>{formatarCentavos(p.centavos)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* -------------------------------- Ações finais */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={onFechar}
            style={{
              minHeight: t.touch.pay,
              flex: 1,
              border: `1px solid ${t.color.border}`,
              borderRadius: t.radius.lg,
              backgroundColor: t.color.surface,
              color: t.color.text,
              fontSize: 16,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Voltar (Esc)
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={!todasQuitado || processando}
            style={{
              minHeight: t.touch.pay,
              flex: 2,
              border: 'none',
              borderRadius: t.radius.lg,
              backgroundColor: todasQuitado && !processando ? t.color.success : t.color.surfaceAlt,
              color: todasQuitado && !processando ? '#FFFFFF' : t.color.textMuted,
              fontSize: 18,
              fontWeight: 800,
              cursor: todasQuitado && !processando ? 'pointer' : 'not-allowed',
            }}
          >
            {processando ? 'PROCESSANDO…' : `CONFIRMAR VENDA ${todasQuitado ? '' : '(falta valor)'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Numero({
  rotulo,
  centavos,
  destaque,
  cor,
}: {
  rotulo: string;
  centavos: number;
  destaque?: boolean;
  cor?: string;
}) {
  return (
    <div
      style={{
        padding: '10px 14px',
        backgroundColor: t.color.surface,
        border: `1px solid ${destaque ? t.color.accent : t.color.border}`,
        borderRadius: t.radius.lg,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: t.color.textMuted }}>{rotulo}</div>
      <div
        style={{
          fontSize: destaque ? 30 : 24,
          fontWeight: 800,
          ...TABULAR,
          color: cor ?? t.color.text,
        }}
      >
        {formatarCentavos(centavos)}
      </div>
    </div>
  );
}

const TABULAR: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: '"tnum"',
};

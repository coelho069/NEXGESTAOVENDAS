/**
 * BarraBuscaPdv — campo de busca SEMPRE focado (PRD step_2).
 * -----------------------------------------------------------------------------
 * UX aplicada:
 *  - Autofocus + refocus automático: qualquer clique em zona morta da tela ou
 *    tecla "solta" devolve o foco aqui. O caixa NUNCA precisa mirar o mouse.
 *  - Feedback instantâneo: borda acentuada quando focada; spinner sutil
 *    durante a busca (não bloqueia digitação).
 *  - Bip de código de barras = "digitação instantânea + Enter": interceptamos
 *    Enter e tentamos barcode EXATO primeiro (evita SELECT ilike largo).
 *  - Dropdown com máx. 6 resultados, Enter = adiciona o 1º (zero toques extras).
 */

'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { pdvTheme as t } from '../theme/pdv-theme';
import { formatarBRL } from '../lib/money';
import type { Produto } from '../lib/types';

interface Props {
  produtos: Produto[];
  buscando: boolean;
  onBuscar: (termo: string) => void;
  onAdicionar: (produto: Produto) => void;
  /** Ref vinda do hook de atalhos (F2 foca aqui). Tipo estrutural: funciona
   *  igual em React 18 (MutableRefObject) e React 19 (RefObject). */
  buscaRef: { current: HTMLInputElement | null };
}

export function BarraBuscaPdv({
  produtos,
  buscando,
  onBuscar,
  onAdicionar,
  buscaRef,
}: Props) {
  const [termo, setTermo] = useState('');
  const [aberto, setAberto] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // ------------------------------------------------------------------
  // FOCO PERSISTENTE (UX central da tela):
  //  1. monta focado;
  //  2. clique em qualquer área "morta" devolve o foco;
  //  3. pressionar dígito/letra solta também devolve (fluidez do teclado).
  // ------------------------------------------------------------------
  useEffect(() => {
    buscaRef.current?.focus();
  }, [buscaRef]);

  useEffect(() => {
    const devolverFoco = (ev: MouseEvent) => {
      const alvo = ev.target as HTMLElement | null;
      const clicouEmBotao = !!alvo?.closest('button, a, input, [role="option"], [role="dialog"]');
      if (!clicouEmBotao) buscaRef.current?.focus();
    };
    // `globalThis.KeyboardEvent` = evento DOM (o nome está sombreado pelo
    // import do React aqui em cima) — evita conflito de tipos 18/19.
    const aoDigitarSolto = (ev: globalThis.KeyboardEvent) => {
      const alvo = ev.target as HTMLElement | null;
      const emCampoTexto =
        alvo instanceof HTMLInputElement || alvo instanceof HTMLTextAreaElement;
      if (!emCampoTexto && /^[a-z0-9]$/i.test(ev.key)) buscaRef.current?.focus();
    };
    document.addEventListener('click', devolverFoco);
    document.addEventListener('keydown', aoDigitarSolto);
    return () => {
      document.removeEventListener('click', devolverFoco);
      document.removeEventListener('keydown', aoDigitarSolto);
    };
  }, [buscaRef]);

  const executarBusca = (novoTermo: string) => {
    setTermo(novoTermo);
    onBuscar(novoTermo);
    setAberto(novoTermo.trim().length > 0);
  };

  /** Enter = tentar bip (barcode exato) -> 1º resultado -> busca por SKU. */
  const aoEnter = () => {
    const primeiro = produtos[0];
    if (primeiro) {
      onAdicionar(primeiro);
      setTermo('');
      setAberto(false);
      onBuscar('');
      return;
    }
    // Nada encontrado: se parece um EAN-13, avisa com flash vermelho.
    if (/^\d{13}$/.test(termo.trim())) {
      setFlash('erro');
      setTimeout(() => setFlash('ok'), 900);
    }
  };

  const [flash, setFlash] = useState<'ok' | 'erro'>('ok');

  const aoKeyDown = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      aoEnter();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      setTermo('');
      setAberto(false);
      onBuscar('');
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      // Navegação por setas vai para o dropdown (primeira opção).
      const primeiraOpcao = wrapperRef.current?.querySelector<HTMLElement>('[role="option"]');
      primeiraOpcao?.focus();
    }
  };

  const estiloCaixa: React.CSSProperties = {
    width: '100%',
    height: Math.max(44, 52),
    backgroundColor: t.color.surface,
    border: `2px solid ${flash === 'erro' ? t.color.danger : t.color.accent}`,
    borderRadius: t.radius.md,
    color: t.color.text,
    fontSize: 18,
    fontWeight: 600,
    padding: '0 88px 0 16px',
    outline: 'none',
    transition: `border-color ${t.motion.instant}`,
  };

  const estiloDropdown: React.CSSProperties = {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    left: 0,
    right: 0,
    zIndex: 30,
    backgroundColor: t.color.surfaceRaised,
    border: `1px solid ${t.color.borderStrong}`,
    borderRadius: t.radius.lg,
    boxShadow: t.shadow.dropdown,
    overflow: 'hidden',
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
      <input
        ref={buscaRef}
        value={termo}
        onChange={(e) => executarBusca(e.target.value)}
        onKeyDown={aoKeyDown}
        placeholder="Bipe o código de barras ou digite nome/SKU…   (F2)"
        aria-label="Buscar produto por nome, SKU ou código de barras"
        autoComplete="off"
        spellCheck={false}
        style={estiloCaixa}
      />

      {/* Feedback de estado SEM esconder o texto digitado */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          right: 14,
          top: '50%',
          transform: 'translateY(-50%)',
          fontSize: 13,
          fontWeight: 700,
          color: buscando ? t.color.accent : flash === 'erro' ? t.color.danger : t.color.textMuted,
        }}
      >
        {buscando ? '…' : flash === 'erro' ? 'CÓD. NÃO ENCONTRADO' : 'F2'}
      </span>

      {aberto && produtos.length > 0 && (
        <ul role="listbox" style={estiloDropdown}>
          {produtos.slice(0, 6).map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === 0}
                onClick={() => {
                  onAdicionar(p);
                  setTermo('');
                  setAberto(false);
                  onBuscar('');
                  buscaRef.current?.focus();
                }}
                style={{
                  width: '100%',
                  minHeight: 44,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '8px 14px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `1px solid ${t.color.border}`,
                  color: t.color.text,
                  fontSize: 15,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.name}
                  <span style={{ color: t.color.textMuted, marginLeft: 8, fontSize: 12 }}>
                    {p.sku ?? p.barcode ?? ''}
                  </span>
                </span>
                <span style={{ ...tabularStyle, color: t.color.textSecondary, whiteSpace: 'nowrap' }}>
                  {formatarBRL(p.unit_price)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const tabularStyle: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: '"tnum"',
};

'use client';

/**
 * Suporte Operacional — pill fixa no topo direito + modal de autoatendimento.
 * [TASK: Implementação de Módulo de Suporte em PDV — Prompt Master]
 *
 * POSICIONAMENTO (justificativa anti-obstrução):
 * - `fixed top-4 right-4 z-[90]`: no layout do NEX, a busca de produtos fica
 *   no topo/centro-esquerda do PDV (F2) e o fluxo de pagamento (total +
 *   "Finalizar Venda") vive na faixa inferior (PaymentSheet). O canto
 *   superior direito é zona morta para a operação de caixa.
 * - z-[90] (alto, mas abaixo de modais críticos como PaymentSheet/receipt,
 *   que usam camada superior) — a pill NUNCA sobrepõe busca, total ou
 *   botão de finalizar venda.
 * - 44px de altura mínima (alvo de toque), pill neutra (slate) com brand
 *   color só no hover, scale-105 @ 200ms.
 *
 * HOTKEYS: F1 ou Ctrl+/ abrem o modal (livres no mapa pdv-shortcuts —
 * F2/F4/F6/F8/F10/Ctrl+K/Esc já têm dono). Esc/click-out/X fecham com
 * stopPropagation para o Esc não vazar para o handler "cancel" do PDV.
 *
 * HIERARQUIA DE RESOLUÇÃO: busca → links rápidos → WhatsApp. O
 * autoatendimento filtra chamados simples antes do canal humano.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HelpCircle, MessageCircle, X } from 'lucide-react';
import { useCardPaymentHealth } from '@/hooks/use-card-payment-health';
import {
  buildPdvHotkeyHints,
  getPdvShortcutKeyLabel,
} from '@/lib/domain/pdv-shortcuts';
import { getSupportWhatsAppUrl } from '@/lib/support/whatsapp';

type QuickLink = {
  id: string;
  label: string;
  hint: string;
};

// Links rápidos = dúvidas mais comuns do balcão (filtro de autoatendimento)
const QUICK_LINKS: QuickLink[] = [
  {
    id: 'cancel-item',
    label: 'Como cancelar um item da venda?',
    hint: `Selecione o item no carrinho e pressione ${getPdvShortcutKeyLabel('removeLine')} para remover, ou use o botão de remover (lixeira).`,
  },
  {
    id: 'close-cash',
    label: 'Fechamento de caixa',
    hint: 'Use o painel Caixa na barra lateral → "Fechar caixa" — informe o dinheiro em gaveta para conferência.',
  },
  {
    id: 'printer',
    label: 'Problemas com a impressora',
    hint: `O recibo abre ao finalizar a venda (${getPdvShortcutKeyLabel('finalize')}). Use Imprimir no diálogo do navegador. Verifique papel e impressora padrão do Windows.`,
  },
  {
    id: 'pix-sync',
    label: 'PIX não confirmou',
    hint: 'Confira o selo de sincronização no topo do PDV. Venda com "pending" sobe sozinha quando a rede voltar.',
  },
];

export function SuporteOperacional() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const cardSelectable = useCardPaymentHealth();
  const whatsappUrl = getSupportWhatsAppUrl();
  const hotkeyHints = useMemo(
    () => buildPdvHotkeyHints({ card: cardSelectable }),
    [cardSelectable],
  );

  const open = useCallback(() => {
    setIsOpen(true);
    setQuery('');
  }, []);
  const close = useCallback(() => {
    setIsOpen(false);
    pillRef.current?.focus();
  }, []);

  // F1 / Ctrl+/ abrem o modal (listener global; F1 nativo do browser é suprimido)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'F1' || (mod && e.key === '/')) {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // Esc fecha (capture phase + stopPropagation: o Esc não deve cancelar venda)
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, close]);

  // Click fora fecha
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (
        !dialogRef.current?.contains(e.target as Node) &&
        !pillRef.current?.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen]);

  // Foco no campo de busca ao abrir (operador digita imediatamente)
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? QUICK_LINKS.filter(
        (l) =>
          l.label.toLowerCase().includes(normalized) ||
          l.hint.toLowerCase().includes(normalized),
      )
    : QUICK_LINKS;

  return (
    <>
      {/* Pill — neutra; brand color apenas no hover; 44px de toque */}
      <button
        ref={pillRef}
        type="button"
        onClick={() => (isOpen ? close() : open())}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className="fixed top-4 right-4 z-[90] flex h-11 items-center gap-2 rounded-full bg-white/95 px-4 text-sm font-medium text-slate-600 shadow-md ring-1 ring-slate-200 backdrop-blur transition-all duration-200 hover:scale-105 hover:bg-emerald-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400"
      >
        <HelpCircle size={18} />
        Suporte Operacional
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Suporte Operacional"
        >
          {/* backdrop com blur; click fora fecha */}
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={close}
          />

          <div
            ref={dialogRef}
            className="relative w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-2">
                <HelpCircle size={20} className="text-emerald-600" />
                <h2 className="text-base font-semibold text-slate-900">
                  Suporte Operacional
                </h2>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Fechar suporte"
                className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-100"
              >
                <X size={20} />
              </button>
            </div>

            {/* Busca rápida — primeiro passo da hierarquia de resolução */}
            <div className="border-b border-slate-200 px-5 py-3">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="Busque sua dúvida… (ex.: cancelar item)"
                className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            {/* Atalhos do PDV — mesma fonte de verdade do hotkeys bar */}
            <div className="border-b border-slate-200 px-5 py-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Atalhos do PDV
              </p>
              <div
                data-testid="support-hotkey-hints"
                className="flex flex-wrap gap-x-3 gap-y-1"
              >
                {hotkeyHints.map((hint) => (
                  <span
                    key={hint.keys + hint.label}
                    className="inline-flex items-center gap-1 text-xs text-slate-600"
                  >
                    <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
                      {hint.keys}
                    </kbd>
                    <span>{hint.label}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* Links rápidos */}
            <div className="max-h-64 overflow-y-auto px-5 py-3">
              {filtered.length > 0 ? (
                <ul className="space-y-2">
                  {filtered.map((link) => (
                    <li key={link.id}>
                      <details className="group rounded-lg border border-slate-200 open:bg-slate-50">
                        <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:text-emerald-700">
                          {link.label}
                        </summary>
                        <p className="px-3 pb-3 text-xs leading-relaxed text-slate-500">
                          {link.hint}
                        </p>
                      </details>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-4 text-center text-sm text-slate-500">
                  Nenhuma dúvida encontrada
                  {whatsappUrl ? ' — fale com o suporte abaixo.' : '.'}
                </p>
              )}
            </div>

            {/* Ação primária — último recurso da hierarquia */}
            <div className="border-t border-slate-200 px-5 py-4">
              {whatsappUrl ? (
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="support-whatsapp-cta"
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
                >
                  <MessageCircle size={18} />
                  Falar com Suporte Agora
                </a>
              ) : null}
              <p className="mt-2 text-center text-[11px] text-slate-400">
                Atalhos: F1 ou Ctrl+/ abre este painel · Esc fecha
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

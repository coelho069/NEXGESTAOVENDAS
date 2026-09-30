"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { HelpCircle, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  buildSupportHotkeyHints,
  getPdvShortcutKeyLabel,
} from "@/lib/domain/pdv-shortcuts";
import { isAnneSupportRoute } from "@/lib/support/anne-chat";
import { OpenAnneSupportButton } from "@/components/support/open-anne-support-button";

type QuickLink = {
  id: string;
  label: string;
  hint: string;
};

const QUICK_LINKS: QuickLink[] = [
  {
    id: "cancel-item",
    label: "Como cancelar um item da venda?",
    hint: "Selecione o item no carrinho e use o botão de remover (lixeira), ou ajuste a quantidade com +/−.",
  },
  {
    id: "close-cash",
    label: "Fechamento de caixa",
    hint: 'Use o painel Caixa na barra lateral → "Fechar caixa" — informe o dinheiro em gaveta para conferência.',
  },
  {
    id: "printer",
    label: "Problemas com a impressora",
    hint: `O recibo abre ao finalizar a venda (${getPdvShortcutKeyLabel("receipt")} quando disponível). Use Imprimir no diálogo do navegador. Verifique papel e impressora padrão do sistema.`,
  },
  {
    id: "pix-sync",
    label: "PIX ou sincronização não confirmou",
    hint: 'Confira o selo de sincronização no topo do PDV. Vendas com status "pending" sobem automaticamente quando a rede voltar.',
  },
];

export function SuporteOperacional() {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const hotkeyHints = useMemo(() => buildSupportHotkeyHints(), []);

  const visible = !loading && Boolean(user) && isAnneSupportRoute(pathname);

  const open = useCallback(() => {
    setIsOpen(true);
    setQuery("");
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    pillRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (event.key === "F1" || (mod && event.key === "/")) {
        event.preventDefault();
        event.stopPropagation();
        setIsOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isOpen, close]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        !dialogRef.current?.contains(event.target as Node) &&
        !pillRef.current?.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  if (!visible) {
    return null;
  }

  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? QUICK_LINKS.filter(
        (link) =>
          link.label.toLowerCase().includes(normalized) ||
          link.hint.toLowerCase().includes(normalized)
      )
    : QUICK_LINKS;

  const handleOpenAnneSupport = () => {
    close();
  };

  return (
    <>
      <button
        ref={pillRef}
        type="button"
        onClick={() => (isOpen ? close() : open())}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className="fixed top-4 right-4 z-[90] flex h-11 items-center gap-2 rounded-full bg-white/95 px-4 text-sm font-medium text-slate-600 shadow-md ring-1 ring-slate-200 backdrop-blur transition-all duration-200 hover:scale-105 hover:bg-emerald-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400"
        data-testid="suporte-operacional-pill"
      >
        <HelpCircle size={18} aria-hidden="true" />
        Suporte Operacional
      </button>

      {isOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Suporte Operacional"
          data-testid="suporte-operacional-dialog"
        >
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={close}
          />

          <div
            ref={dialogRef}
            className="relative w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-2">
                <HelpCircle size={20} className="text-emerald-600" aria-hidden="true" />
                <h2 className="text-base font-semibold text-slate-900">Suporte Operacional</h2>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Fechar suporte"
                className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-100"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <div className="border-b border-slate-200 px-5 py-3">
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder="Busque sua dúvida… (ex.: cancelar item)"
                className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

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

            <div className="max-h-64 overflow-y-auto px-5 py-3">
              {filtered.length > 0 ? (
                <ul className="space-y-2">
                  {filtered.map((link) => (
                    <li key={link.id}>
                      <details className="group rounded-lg border border-slate-200 open:bg-slate-50">
                        <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:text-emerald-700">
                          {link.label}
                        </summary>
                        <p className="px-3 pb-3 text-xs leading-relaxed text-slate-500">{link.hint}</p>
                      </details>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-4 text-center text-sm text-slate-500">
                  Nenhuma dúvida encontrada — fale com o suporte abaixo.
                </p>
              )}
            </div>

            <div className="border-t border-slate-200 px-5 py-4">
              <OpenAnneSupportButton
                label="Abrir chat de suporte"
                testId="support-anne-chat-cta"
                onOpen={handleOpenAnneSupport}
              />
              <p className="mt-2 text-center text-[11px] text-slate-400">
                Atalhos: F1 ou Ctrl+/ abre este painel · Esc fecha
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

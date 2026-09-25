'use client';

/**
 * ChatWidget do HERMES — assistente do NEX Gestão Vendas.
 * Padrão NEX: Tailwind-only, lucide-react, botões grandes, hotkey Esc.
 * Resiliente: falha de API/banco NÃO trava a renderização da UI.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';

type ChatRole = 'user' | 'hermes';

type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
};

const WELCOME: ChatMessage = {
  id: 'welcome',
  role: 'hermes',
  text: 'Olá! Sou o HERMES. Como posso ajudar com o PDV?',
};

// Fallback offline: o widget nunca fica "travado" se o backend estiver fora
const OFFLINE_REPLY: ChatMessage = {
  id: 'offline',
  role: 'hermes',
  text: '⚠️ Sem conexão com o servidor agora. Tente novamente em instantes.',
};

export function HermesChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll para a última mensagem
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, isOpen]);

  // Esc fecha (não rouba hotkeys do PDV como F9)
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || isSending) return;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text };
    setMessages((prev) => [...prev, userMsg]);
    setDraft('');
    setIsSending(true);

    try {
      // Endpoint do agente Hermes — trocar quando o backend for definido
      const res = await fetch('/api/hermes/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { reply: string };

      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'hermes', text: data.reply },
      ]);
    } catch (err) {
      // Falha de rede/banco cai aqui; a UI continua íntegra
      console.error('Falha ao enviar mensagem do chat do Hermes:', err);
      setMessages((prev) => [...prev, { ...OFFLINE_REPLY, id: crypto.randomUUID() }]);
    } finally {
      setIsSending(false);
    }
  }, [draft, isSending]);

  return (
    /*
     * Container: fixed + z-[9999] garante visibilidade acima de modais,
     * tabelas e overlays do PDV.
     */
    <div className="fixed bottom-6 right-6 z-[9999]">
      {/*
       * BOTÃO FORA DA CONDICIONAL DA JANELA: o FAB fica montado sempre;
       * ele só troca de aparência/aria quando o chat abre.
       */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-label={isOpen ? 'Fechar chat do Hermes' : 'Abrir chat do Hermes'}
        aria-expanded={isOpen}
        className={`flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg ring-2 ring-white/70 transition-all active:scale-95 focus:outline-none focus:ring-2 focus:ring-blue-400 ${
          isOpen ? 'bg-slate-700 hover:bg-slate-800' : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {isOpen ? <X size={26} /> : <MessageCircle size={28} />}
      </button>

      {isOpen && (
        <div className="mb-3 flex h-96 w-80 flex-col overflow-hidden rounded-lg bg-white shadow-2xl ring-1 ring-slate-200">
          {/* Header */}
          <div className="flex items-center justify-between bg-blue-600 px-4 py-3 text-white">
            <span className="text-sm font-semibold">Hermes · Suporte NEX</span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Fechar chat"
              className="rounded p-1 transition-colors hover:bg-blue-700"
            >
              <X size={20} />
            </button>
          </div>

          {/* Mensagens */}
          <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'ml-auto bg-blue-600 text-white'
                    : 'mr-auto bg-white text-slate-800 shadow'
                }`}
              >
                {msg.text}
              </div>
            ))}
            {isSending && (
              <div className="mr-auto rounded-lg bg-white px-3 py-2 text-sm text-slate-400 shadow">
                digitando…
              </div>
            )}
          </div>

          {/* Input */}
          <div className="flex items-center gap-2 border-t border-slate-200 p-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Digite sua mensagem…"
              disabled={isSending}
              className="h-11 flex-1 rounded-md border border-slate-300 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={isSending || !draft.trim()}
              aria-label="Enviar mensagem"
              className="flex h-11 w-11 items-center justify-center rounded-md bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

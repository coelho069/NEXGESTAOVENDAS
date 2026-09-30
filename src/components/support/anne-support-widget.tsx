"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { usePathname } from "next/navigation";
import { MessageCircle, SendHorizontal, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useAnneChat } from "@/hooks/use-anne-chat";
import {
  ANNE_CHAT_MAX_MESSAGE_LENGTH,
  ANNE_SUPPORT_EMAIL,
  isAnneSupportRoute,
} from "@/lib/support/anne-chat";
import { ANNE_SUPPORT_OPEN_EVENT } from "@/lib/support/open-anne-support";

function PlainTextMessage({ content }: { content: string }) {
  return <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{content}</p>;
}

function TypingIndicator() {
  return (
    <div
      className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2"
      aria-label="Anne está digitando"
      data-testid="anne-typing-indicator"
    >
      <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.2s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.1s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
    </div>
  );
}

export function AnneSupportWidget() {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { messages, input, setInput, sending, canSend, sendMessage, initialized } = useAnneChat(
    user?.id ?? null
  );

  const visible = !loading && Boolean(user) && isAnneSupportRoute(pathname);
  const onPdvRoute = pathname === "/pdv" || pathname.startsWith("/pdv/");

  useEffect(() => {
    if (!open) return;
    const container = messagesRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, open, sending]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener(ANNE_SUPPORT_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(ANNE_SUPPORT_OPEN_EVENT, handleOpen);
  }, []);

  if (!visible || !initialized) {
    return null;
  }

  const handleSubmit = () => {
    if (!canSend) return;
    void sendMessage();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    handleSubmit();
  };

  return (
    <div
      className={`fixed z-40 flex flex-col items-end gap-3 ${
        onPdvRoute ? "bottom-24 right-4 sm:bottom-6 sm:right-6" : "bottom-6 right-4 sm:right-6"
      }`}
      data-testid="anne-support-widget"
    >
      {open ? (
        <section
          id="anne-support-panel"
          aria-label="Chat de suporte NEX"
          className="flex w-[min(100vw-2rem,22rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
          data-testid="anne-support-panel"
        >
          <header className="flex items-center justify-between border-b border-slate-200 bg-emerald-600 px-4 py-3 text-white">
            <div>
              <h2 className="text-sm font-semibold">Suporte NEX</h2>
              <p className="text-xs text-emerald-100">Anne · assistente virtual</p>
            </div>
            <button
              type="button"
              aria-label="Fechar chat de suporte"
              className="rounded-lg p-1 transition hover:bg-emerald-700"
              onClick={() => setOpen(false)}
              data-testid="anne-support-close"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          <div
            ref={messagesRef}
            className="flex max-h-[min(24rem,calc(100vh-12rem))] flex-col gap-3 overflow-y-auto px-4 py-4"
            data-testid="anne-support-messages"
          >
            {messages.map((message) => (
              <article
                key={message.id}
                className={`max-w-[90%] rounded-2xl px-3 py-2 ${
                  message.role === "user"
                    ? "ml-auto rounded-br-md bg-emerald-600 text-white"
                    : "mr-auto rounded-bl-md bg-slate-100 text-slate-900"
                }`}
                data-testid={`anne-message-${message.role}`}
              >
                <PlainTextMessage content={message.content} />
              </article>
            ))}
            {sending ? <TypingIndicator /> : null}
          </div>

          <footer className="border-t border-slate-200 bg-slate-50 p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => setInput(event.target.value.slice(0, ANNE_CHAT_MAX_MESSAGE_LENGTH))}
                onKeyDown={handleKeyDown}
                rows={2}
                maxLength={ANNE_CHAT_MAX_MESSAGE_LENGTH}
                disabled={sending}
                placeholder="Digite sua dúvida..."
                aria-label="Mensagem para o suporte"
                className="min-h-[3rem] flex-1 resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-emerald-500 transition focus:border-emerald-500 focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-100"
                data-testid="anne-support-input"
              />
              <button
                type="button"
                aria-label="Enviar mensagem"
                disabled={!canSend}
                onClick={handleSubmit}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
                data-testid="anne-support-send"
              >
                <SendHorizontal size={18} aria-hidden="true" />
              </button>
            </div>
            <p className="mt-2 text-right text-xs text-slate-500">
              {input.length}/{ANNE_CHAT_MAX_MESSAGE_LENGTH}
            </p>
            <p className="mt-2 text-center text-xs text-slate-500">
              Em caso de dúvida, entre em contato pelo{" "}
              <a
                href={`mailto:${ANNE_SUPPORT_EMAIL}`}
                className="font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
              >
                {ANNE_SUPPORT_EMAIL}
              </a>
              .
            </p>
          </footer>
        </section>
      ) : null}

      <button
        type="button"
        aria-expanded={open}
        aria-controls="anne-support-panel"
        aria-label={open ? "Recolher chat de suporte" : "Abrir chat de suporte"}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold text-emerald-800 shadow-lg transition hover:border-emerald-400 hover:bg-emerald-50"
        data-testid="anne-support-toggle"
      >
        <MessageCircle size={20} aria-hidden="true" />
        <span>Suporte</span>
      </button>
    </div>
  );
}

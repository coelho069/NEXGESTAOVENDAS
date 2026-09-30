"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ANNE_GREETING,
  readStoredConversaId,
  sendAnneChatMessage,
  writeStoredConversaId,
} from "@/lib/support/anne-chat";

export type AnneChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

function createMessageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function useAnneChat(userId: string | null) {
  const [messages, setMessages] = useState<AnneChatMessage[]>([]);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const conversaIdRef = useRef<string | null>(null);

  useEffect(() => {
    conversaIdRef.current = conversaId;
  }, [conversaId]);

  useEffect(() => {
    if (!userId) {
      setMessages([]);
      setConversaId(null);
      setInput("");
      setInitialized(false);
      return;
    }

    const storedConversaId = readStoredConversaId(userId);
    setConversaId(storedConversaId);
    setMessages([{ id: "anne-greeting", role: "assistant", content: ANNE_GREETING }]);
    setInput("");
    setInitialized(true);
  }, [userId]);

  const canSend = useMemo(() => input.trim().length > 0 && !sending, [input, sending]);

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || sending || !userId) return;

    const userMessage: AnneChatMessage = {
      id: createMessageId(),
      role: "user",
      content: trimmed,
    };

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setSending(true);

    try {
      const result = await sendAnneChatMessage({
        message: trimmed,
        conversa_id: conversaIdRef.current ?? undefined,
      });

      if (!result.ok) {
        if (result.unauthorized) {
          setMessages((current) => [
            ...current,
            {
              id: createMessageId(),
              role: "assistant",
              content: "Sua sessão expirou. Faça login novamente para continuar o chat.",
            },
          ]);
          return;
        }

        setMessages((current) => [
          ...current,
          {
            id: createMessageId(),
            role: "assistant",
            content: result.message,
          },
        ]);
        return;
      }

      if (result.data.conversa_id) {
        setConversaId(result.data.conversa_id);
        writeStoredConversaId(userId, result.data.conversa_id);
      }

      setMessages((current) => [
        ...current,
        {
          id: createMessageId(),
          role: "assistant",
          content: result.data.reply,
        },
      ]);
    } finally {
      setSending(false);
    }
  }, [input, sending, userId]);

  return {
    messages,
    input,
    setInput,
    sending,
    canSend,
    sendMessage,
    initialized,
    conversaId,
  };
}

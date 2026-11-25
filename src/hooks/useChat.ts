import { useState, useEffect, useCallback, useRef } from 'react';
import { sendChatMessage, ChatChunk, ChatMessage, safeListen } from '../lib/tauri';

export interface LocalChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  isError?: boolean;
}

export function useChat() {
  const [messages, setMessages] = useState<LocalChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesRef = useRef<LocalChatMessage[]>([]);
  messagesRef.current = messages;

  useEffect(() => {
    const unlisten = safeListen<ChatChunk & { error?: string }>('chat-chunk', (event) => {
      const { message, done, error } = event.payload;

      if (error) {
        setMessages((prev) => {
          const filtered = prev.filter((m) => m.id !== 'current-stream');
          return [
            ...filtered,
            {
              id: `error-${Date.now()}`,
              role: 'assistant',
              content: error,
              timestamp: new Date().toISOString(),
              isError: true,
            },
          ];
        });
        setIsStreaming(false);
        return;
      }

      if (message && message.content) {
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.role === 'assistant' && lastMsg.id === 'current-stream') {
            const newMessages = [...prev];
            newMessages[newMessages.length - 1] = {
              ...lastMsg,
              content: lastMsg.content + message.content,
            };
            return newMessages;
          } else {
            return [
              ...prev,
              {
                id: 'current-stream',
                role: 'assistant',
                content: message.content,
                timestamp: new Date().toISOString(),
              },
            ];
          }
        });
      }

      if (done) {
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.id === 'current-stream') {
            const newMessages = [...prev];
            newMessages[newMessages.length - 1] = {
              ...lastMsg,
              id: `assistant-${Date.now()}`,
            };
            return newMessages;
          }
          return prev;
        });
        setIsStreaming(false);
      }
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const sendMessage = useCallback(
    async (
      content: string,
      model?: string,
      options?: { systemPrompt?: string; temperature?: number }
    ) => {
      const tempId = `user-${Date.now()}`;
      const userMsg: LocalChatMessage = {
        id: tempId,
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
      };

      const historyPayload: ChatMessage[] = [
        ...messagesRef.current
          .filter((m) => !m.isError && m.content.trim().length > 0)
          .slice(-16)
          .map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content },
      ];

      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);

      try {
        await sendChatMessage(content, model, {
          messages: historyPayload,
          system_prompt: options?.systemPrompt,
          temperature: options?.temperature,
        });
      } catch (err: any) {
        console.error('Failed to send chat message:', err);
        const errText =
          typeof err === 'string'
            ? err
            : err?.message || 'Failed to communicate with the Host AI Engine.';
        setMessages((prev) => {
          const filtered = prev.filter((m) => m.id !== 'current-stream');
          // Avoid duplicating if chat-chunk error event already inserted this error
          const last = filtered[filtered.length - 1];
          if (last?.isError) return filtered;
          return [
            ...filtered,
            {
              id: `error-${Date.now()}`,
              role: 'assistant',
              content: errText,
              timestamp: new Date().toISOString(),
              isError: true,
            },
          ];
        });
        setIsStreaming(false);
      }
    },
    []
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setIsStreaming(false);
  }, []);

  return { messages, sendMessage, isStreaming, clearMessages };
}

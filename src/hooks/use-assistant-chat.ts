"use client";

import { useCallback, useRef, useState } from "react";
import { applySSEEvent } from "./sse-event-reducer";
import type { SSEEvent } from "./sse-event-reducer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MessageRole = "user" | "assistant" | "thinking" | "tool";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  toolName?: string;
  isStreaming?: boolean;
  imageFilenames?: string[];
}

export interface UseAssistantChatReturn {
  messages: ChatMessage[];
  isThinking: boolean;
  sendMessage: (text: string) => void;
  status: "idle" | "connecting" | "streaming" | "error";
}

// ---------------------------------------------------------------------------
// ID generator
// ---------------------------------------------------------------------------

function nextId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAssistantChat(opts: {
  enabled: boolean;
}): UseAssistantChatReturn {
  const { enabled } = opts;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<"idle" | "connecting" | "streaming" | "error">("idle");

  // Use ref as the source of truth for messages — avoids React batching issues
  // with closures in async stream processing
  const msgsRef = useRef<ChatMessage[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Sync ref → state (triggers re-render)
  const flush = useCallback(() => {
    setMessages([...msgsRef.current]);
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!enabled || !text.trim()) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Add user message + thinking indicator
      const thinkingId = nextId();
      msgsRef.current = [
        ...msgsRef.current,
        { id: nextId(), role: "user", content: text },
        { id: thinkingId, role: "thinking", content: "", isStreaming: true },
      ];
      flush();
      setStatus("connecting");

      let assistantMsgId: string | null = null;

      try {
        const res = await fetch("/api/internal/assistant/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            sessionId: sessionIdRef.current,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const errorText = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}: ${errorText}`);
        }

        setStatus("streaming");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events: split on \n, process "data: " lines
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;

            let event: SSEEvent;
            try {
              event = JSON.parse(jsonStr) as SSEEvent;
            } catch {
              continue;
            }

            if (event.sessionId) {
              sessionIdRef.current = event.sessionId;
            }

            // Apply event via pure reducer — delegates state transformation out of the hook
            const next = applySSEEvent(
              { messages: msgsRef.current, assistantMsgId, status: "streaming" },
              event,
              thinkingId,
              nextId
            );
            msgsRef.current = next.messages;
            assistantMsgId = next.assistantMsgId;
            if (next.status === "error" || next.status === "idle") {
              setStatus(next.status);
            }
            flush();
          }
        }

        // Process remaining buffer
        if (buffer.trim()) {
          const remaining = buffer + "\n";
          const lines = remaining.split("\n");
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6).trim()) as SSEEvent;
              if (event.type === "done") {
                msgsRef.current = msgsRef.current.filter((m) => m.id !== thinkingId);
                flush();
                setStatus("idle");
              }
            } catch { /* skip */ }
          }
        }

        // Final cleanup
        msgsRef.current = msgsRef.current.filter((m) => m.id !== thinkingId);
        flush();
        setStatus((s) => (s === "streaming" ? "idle" : s));
      } catch (err: unknown) {
        if ((err as Error).name === "AbortError") return;
        msgsRef.current = [
          ...msgsRef.current.filter((m) => m.id !== thinkingId),
          {
            id: nextId(),
            role: "assistant" as MessageRole,
            content: `Connection error: ${(err as Error).message ?? "Unknown error"}`,
          },
        ];
        flush();
        setStatus("error");
      }
    },
    [enabled, flush]
  );

  const lastMsg = messages[messages.length - 1];
  const isThinking =
    status === "connecting" || status === "streaming" ||
    (lastMsg?.role === "thinking" && lastMsg.isStreaming === true);

  return { messages, isThinking, sendMessage, status };
}

"use client";

import { useCallback, useRef, useState } from "react";

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
// SSE event type
// ---------------------------------------------------------------------------

interface SSEEvent {
  type: "text" | "tool_use" | "tool_result" | "error" | "done";
  content?: string;
  sessionId?: string;
  toolInput?: unknown;
  toolOutput?: string;
}

// ---------------------------------------------------------------------------
// Parse SSE lines from a raw text buffer.
// Returns array of parsed events and any remaining incomplete data.
// ---------------------------------------------------------------------------

function parseSSEBuffer(buffer: string): { events: SSEEvent[]; remaining: string } {
  const events: SSEEvent[] = [];
  const lines = buffer.split("\n");
  const remaining = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const jsonStr = line.slice(6).trim();
    if (!jsonStr) continue;
    try {
      events.push(JSON.parse(jsonStr) as SSEEvent);
    } catch {
      // skip malformed
    }
  }

  return { events, remaining };
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

  const sessionIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!enabled || !text.trim()) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Optimistic user bubble
      const userMsg: ChatMessage = { id: nextId(), role: "user", content: text };
      // Thinking indicator
      const thinkingId = nextId();

      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: thinkingId, role: "thinking", content: "", isStreaming: true },
      ]);
      setStatus("connecting");

      // Track assistant message id for incremental text appends
      let assistantMsgId: string | null = null;

      function applyEvent(event: SSEEvent) {
        if (event.sessionId) {
          sessionIdRef.current = event.sessionId;
        }

        switch (event.type) {
          case "text": {
            setMessages((prev) => {
              const filtered = prev.filter((m) => m.id !== thinkingId);

              if (assistantMsgId) {
                return filtered.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, content: m.content + (event.content ?? ""), isStreaming: true }
                    : m
                );
              }

              assistantMsgId = nextId();
              return [
                ...filtered,
                {
                  id: assistantMsgId,
                  role: "assistant" as MessageRole,
                  content: event.content ?? "",
                  isStreaming: true,
                },
              ];
            });
            break;
          }

          case "tool_use": {
            setMessages((prev) => {
              const filtered = prev.filter((m) => m.id !== thinkingId);
              const updated = assistantMsgId
                ? filtered.map((m) =>
                    m.id === assistantMsgId ? { ...m, isStreaming: false } : m
                  )
                : filtered;
              assistantMsgId = null;
              return [
                ...updated,
                {
                  id: nextId(),
                  role: "tool" as MessageRole,
                  content: JSON.stringify(event.toolInput ?? {}, null, 2),
                  toolName: event.content,
                },
              ];
            });
            break;
          }

          case "tool_result": {
            setMessages((prev) => [
              ...prev,
              {
                id: nextId(),
                role: "tool" as MessageRole,
                content: String(event.toolOutput ?? ""),
                toolName: `${event.content ?? "tool"} (result)`,
              },
            ]);
            break;
          }

          case "error": {
            setMessages((prev) => {
              const filtered = prev.filter((m) => m.id !== thinkingId);
              return [
                ...filtered,
                {
                  id: nextId(),
                  role: "assistant" as MessageRole,
                  content: `Error: ${event.content ?? "Unknown error"}`,
                },
              ];
            });
            setStatus("error");
            break;
          }

          case "done": {
            if (assistantMsgId) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId ? { ...m, isStreaming: false } : m
                )
              );
            }
            setMessages((prev) => prev.filter((m) => m.id !== thinkingId));
            setStatus("idle");
            break;
          }
        }
      }

      try {
        console.log("[chat] Sending to /api/internal/assistant/chat...");
        const res = await fetch("/api/internal/assistant/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            sessionId: sessionIdRef.current,
          }),
          signal: controller.signal,
        });

        console.log("[chat] Response status:", res.status, "has body:", !!res.body);

        if (!res.ok || !res.body) {
          const errorText = await res.text().catch(() => "");
          console.error("[chat] Error response:", errorText);
          throw new Error(`HTTP ${res.status}: ${errorText}`);
        }

        setStatus("streaming");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log("[chat] Stream done. Remaining buffer:", buffer.length, "chars");
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          console.log("[chat] Chunk received:", chunk.length, "chars");
          buffer += chunk;
          const { events, remaining } = parseSSEBuffer(buffer);
          buffer = remaining;

          console.log("[chat] Parsed", events.length, "events from chunk");
          for (const event of events) {
            console.log("[chat] Event:", event.type, event.content?.slice(0, 50));
            applyEvent(event);
          }
        }

        // Process any remaining data in buffer after stream ends
        if (buffer.trim()) {
          console.log("[chat] Processing remaining buffer:", buffer.length);
          const { events } = parseSSEBuffer(buffer + "\n");
          for (const event of events) {
            applyEvent(event);
          }
        }

        setStatus((s) => (s === "streaming" ? "idle" : s));
        setMessages((prev) => prev.filter((m) => m.id !== thinkingId));
      } catch (err: unknown) {
        if ((err as Error).name === "AbortError") return;
        setMessages((prev) => {
          const filtered = prev.filter((m) => m.id !== thinkingId);
          return [
            ...filtered,
            {
              id: nextId(),
              role: "assistant" as MessageRole,
              content: `Connection error: ${(err as Error).message ?? "Unknown error"}`,
            },
          ];
        });
        setStatus("error");
      }
    },
    [enabled]
  );

  const lastMsg = messages[messages.length - 1];
  const isThinking =
    status === "connecting" || status === "streaming" ||
    (lastMsg?.role === "thinking" && lastMsg.isStreaming === true);

  return { messages, isThinking, sendMessage, status };
}

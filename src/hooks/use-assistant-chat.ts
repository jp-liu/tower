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
// SSE event parser — from "data: {...}\n\n" lines
// ---------------------------------------------------------------------------

interface SSEEvent {
  type: "text" | "tool_use" | "tool_result" | "error" | "done";
  content?: string;
  sessionId?: string;
  toolInput?: unknown;
  toolOutput?: string;
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

  // Track session ID for multi-turn (resume support)
  const sessionIdRef = useRef<string | null>(null);
  // AbortController for cancelling in-flight requests
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!enabled || !text.trim()) return;

      // Abort any previous in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Add user message immediately (optimistic)
      const userMsg: ChatMessage = { id: nextId(), role: "user", content: text };
      setMessages((prev) => [...prev, userMsg]);

      // Add thinking indicator
      const thinkingId = nextId();
      setMessages((prev) => [
        ...prev,
        { id: thinkingId, role: "thinking", content: "", isStreaming: true },
      ]);
      setStatus("connecting");

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
          throw new Error(`HTTP ${res.status}`);
        }

        setStatus("streaming");

        // Remove thinking indicator, prepare for assistant message
        let assistantMsgId: string | null = null;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events from buffer
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6);
            if (!jsonStr) continue;

            let event: SSEEvent;
            try {
              event = JSON.parse(jsonStr) as SSEEvent;
            } catch {
              continue;
            }

            // Capture session ID for multi-turn
            if (event.sessionId) {
              sessionIdRef.current = event.sessionId;
            }

            switch (event.type) {
              case "text": {
                setMessages((prev) => {
                  // Remove thinking indicator if still present
                  const filtered = prev.filter((m) => m.id !== thinkingId);

                  if (assistantMsgId) {
                    // Append to existing assistant message
                    return filtered.map((m) =>
                      m.id === assistantMsgId
                        ? { ...m, content: m.content + (event.content ?? ""), isStreaming: true }
                        : m
                    );
                  } else {
                    // Create new assistant message
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
                  }
                });
                break;
              }

              case "tool_use": {
                setMessages((prev) => {
                  const filtered = prev.filter((m) => m.id !== thinkingId);
                  // Finalize current assistant message if any
                  const updated = assistantMsgId
                    ? filtered.map((m) =>
                        m.id === assistantMsgId ? { ...m, isStreaming: false } : m
                      )
                    : filtered;
                  assistantMsgId = null; // Next text block starts fresh
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
                // Finalize streaming assistant message
                if (assistantMsgId) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsgId ? { ...m, isStreaming: false } : m
                    )
                  );
                }
                // Remove any remaining thinking indicator
                setMessages((prev) => prev.filter((m) => m.id !== thinkingId));
                setStatus("idle");
                break;
              }
            }
          }
        }

        // Ensure status is idle after stream ends
        setStatus("idle");
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
    status === "connecting" ||
    (lastMsg?.role === "thinking" && lastMsg.isStreaming === true);

  return { messages, isThinking, sendMessage, status };
}

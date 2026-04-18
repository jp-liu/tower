"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { getConfigValue } from "@/actions/config-actions";
import { ASSISTANT_SESSION_KEY } from "@/lib/assistant-constants";
import type { ChatMessage, MessageRole } from "@/hooks/use-assistant-chat";

// ---------------------------------------------------------------------------
// Context types
// ---------------------------------------------------------------------------

interface AssistantContextValue {
  isOpen: boolean;
  isStarting: boolean;
  displayMode: "sidebar" | "dialog";
  communicationMode: "terminal" | "chat";
  worktreePath: string | null;
  toggleAssistant: () => void;
  closeAssistant: () => void;
  // Chat state — persisted at provider level so it survives route changes
  chatMessages: ChatMessage[];
  chatStatus: "idle" | "connecting" | "streaming" | "error";
  isChatThinking: boolean;
  sendChatMessage: (text: string) => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

// ---------------------------------------------------------------------------
// ID generator (same as in use-assistant-chat.ts)
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
// Provider
// ---------------------------------------------------------------------------

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [displayMode, setDisplayMode] = useState<"sidebar" | "dialog">("sidebar");
  const [communicationMode, setCommunicationMode] = useState<"terminal" | "chat">("terminal");
  const [worktreePath, setWorktreePath] = useState<string | null>(null);

  // Chat state — lives here so it persists across route changes
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatStatus, setChatStatus] = useState<"idle" | "connecting" | "streaming" | "error">("idle");
  const msgsRef = useRef<ChatMessage[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const flushChat = useCallback(() => {
    setChatMessages([...msgsRef.current]);
  }, []);

  // Read config
  const refreshConfig = useCallback(async () => {
    const [dm, cm] = await Promise.all([
      getConfigValue<string>("assistant.displayMode", "sidebar"),
      getConfigValue<string>("assistant.communicationMode", "terminal"),
    ]);
    setDisplayMode(dm === "dialog" ? "dialog" : "sidebar");
    setCommunicationMode(cm === "chat" ? "chat" : "terminal");
  }, []);

  useEffect(() => { refreshConfig(); }, [refreshConfig]);

  const openAssistant = useCallback(async () => {
    setIsStarting(true);
    try {
      await refreshConfig();
      const latestCommMode = await getConfigValue<string>("assistant.communicationMode", "terminal");
      if (latestCommMode === "chat") {
        setIsOpen(true);
        return;
      }
      // Terminal mode: create PTY session
      const res = await fetch("/api/internal/assistant", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unknown error");
      setWorktreePath(ASSISTANT_SESSION_KEY);
      setIsOpen(true);
    } catch {
      toast.error("Session failed to start. Try again.");
    } finally {
      setIsStarting(false);
    }
  }, [refreshConfig]);

  const closeAssistant = useCallback(() => {
    setIsOpen(false);
    if (worktreePath) {
      setWorktreePath(null);
      fetch("/api/internal/assistant", { method: "DELETE" }).catch(() => {});
    }
    // Abort any in-flight chat request
    abortRef.current?.abort();
  }, [worktreePath]);

  const toggleAssistant = useCallback(() => {
    if (isOpen || isStarting) {
      closeAssistant();
    } else {
      openAssistant();
    }
  }, [isOpen, isStarting, closeAssistant, openAssistant]);

  // Keyboard shortcut: Cmd+L / Ctrl+L
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "l") {
        e.preventDefault();
        toggleAssistant();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggleAssistant]);

  // -------------------------------------------------------------------------
  // Chat message sender — lives at provider level for persistence
  // -------------------------------------------------------------------------
  const sendChatMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const thinkingId = nextId();
    msgsRef.current = [
      ...msgsRef.current,
      { id: nextId(), role: "user" as MessageRole, content: text },
      { id: thinkingId, role: "thinking" as MessageRole, content: "", isStreaming: true },
    ];
    flushChat();
    setChatStatus("connecting");

    let assistantMsgId: string | null = null;

    try {
      const res = await fetch("/api/internal/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId: sessionIdRef.current }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      setChatStatus("streaming");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let event: SSEEvent;
          try { event = JSON.parse(line.slice(6).trim()); } catch { continue; }
          if (event.sessionId) sessionIdRef.current = event.sessionId;

          switch (event.type) {
            case "text": {
              const filtered = msgsRef.current.filter((m) => m.id !== thinkingId);
              if (assistantMsgId) {
                msgsRef.current = filtered.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, content: m.content + (event.content ?? ""), isStreaming: true }
                    : m
                );
              } else {
                assistantMsgId = nextId();
                msgsRef.current = [...filtered, {
                  id: assistantMsgId, role: "assistant" as MessageRole,
                  content: event.content ?? "", isStreaming: true,
                }];
              }
              flushChat();
              break;
            }
            case "tool_use": {
              const filtered = msgsRef.current.filter((m) => m.id !== thinkingId);
              const updated = assistantMsgId
                ? filtered.map((m) => m.id === assistantMsgId ? { ...m, isStreaming: false } : m)
                : filtered;
              assistantMsgId = null;
              msgsRef.current = [...updated, {
                id: nextId(), role: "tool" as MessageRole,
                content: JSON.stringify(event.toolInput ?? {}, null, 2),
                toolName: event.content,
              }];
              flushChat();
              break;
            }
            case "tool_result": {
              msgsRef.current = [...msgsRef.current, {
                id: nextId(), role: "tool" as MessageRole,
                content: String(event.toolOutput ?? ""),
                toolName: `${event.content ?? "tool"} (result)`,
              }];
              flushChat();
              break;
            }
            case "error": {
              msgsRef.current = [...msgsRef.current.filter((m) => m.id !== thinkingId), {
                id: nextId(), role: "assistant" as MessageRole,
                content: `Error: ${event.content ?? "Unknown error"}`,
              }];
              flushChat();
              setChatStatus("error");
              break;
            }
            case "done": {
              if (assistantMsgId) {
                msgsRef.current = msgsRef.current.map((m) =>
                  m.id === assistantMsgId ? { ...m, isStreaming: false } : m
                );
              }
              msgsRef.current = msgsRef.current.filter((m) => m.id !== thinkingId);
              flushChat();
              setChatStatus("idle");
              break;
            }
          }
        }
      }

      // Final cleanup
      msgsRef.current = msgsRef.current.filter((m) => m.id !== thinkingId);
      flushChat();
      setChatStatus((s) => (s === "streaming" ? "idle" : s));
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") return;
      msgsRef.current = [...msgsRef.current.filter((m) => m.id !== thinkingId), {
        id: nextId(), role: "assistant" as MessageRole,
        content: `Connection error: ${(err as Error).message ?? "Unknown error"}`,
      }];
      flushChat();
      setChatStatus("error");
    }
  }, [flushChat]);

  const lastMsg = chatMessages[chatMessages.length - 1];
  const isChatThinking =
    chatStatus === "connecting" || chatStatus === "streaming" ||
    (lastMsg?.role === "thinking" && lastMsg.isStreaming === true);

  return (
    <AssistantContext.Provider
      value={{
        isOpen, isStarting, displayMode, communicationMode, worktreePath,
        toggleAssistant, closeAssistant,
        chatMessages, chatStatus, isChatThinking, sendChatMessage,
      }}
    >
      {children}
    </AssistantContext.Provider>
  );
}

export function useAssistant(): AssistantContextValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error("useAssistant must be used within an AssistantProvider");
  return ctx;
}

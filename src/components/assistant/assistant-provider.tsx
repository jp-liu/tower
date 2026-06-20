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
import { useActionShortcut } from "@/lib/shortcuts";
import { getConfigValue } from "@/actions/config-actions";
import { ASSISTANT_SESSION_KEY } from "@/lib/assistant-constants";
import type { ChatMessage, MessageRole } from "@/hooks/use-assistant-chat";
import {
  type AssistantSession,
  getSessions,
  addSession,
  deleteSession,
  updateSession,
  getActiveSessionId,
  setActiveSessionId,
  buildSessionTitle,
} from "@/lib/assistant-sessions";

// ---------------------------------------------------------------------------
// Context types
// ---------------------------------------------------------------------------

interface AssistantContextValue {
  isOpen: boolean;
  isStarting: boolean;
  displayMode: "sidebar" | "dialog";
  worktreePath: string | null;
  toggleAssistant: () => void;
  closeAssistant: () => void;
  focusAssistantInput: () => void;
  /** Bumped to request the chat input take focus while already mounted. */
  inputFocusSignal: number;
  // Chat state — persisted at provider level so it survives route changes
  chatMessages: ChatMessage[];
  chatStatus: "idle" | "connecting" | "streaming" | "error";
  isChatThinking: boolean;
  isLoadingHistory: boolean;
  sendChatMessage: (text: string, options?: { attachmentFilenames?: string[] }) => void;
  cancelChat: () => string | null;
  // Session management
  sessions: AssistantSession[];
  activeSessionId: string | null;
  createNewSession: () => void;
  switchSession: (sessionId: string) => void;
  removeSession: (sessionId: string) => void;
  renameSession: (sessionId: string, title: string) => void;
  refreshSessions: () => Promise<AssistantSession[]>;
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
// sessionStorage attachment cache — preserves attachmentFilenames across page reload
// ---------------------------------------------------------------------------

const ATTACHMENT_CACHE_KEY = "assistant-attachment-cache";

function cacheMessageAttachments(sessionId: string, userMsgIndex: number, filenames: string[]): void {
  try {
    const raw = sessionStorage.getItem(ATTACHMENT_CACHE_KEY);
    const cache: Record<string, Record<number, string[]>> = raw ? JSON.parse(raw) : {};
    if (!cache[sessionId]) cache[sessionId] = {};
    cache[sessionId][userMsgIndex] = filenames;
    sessionStorage.setItem(ATTACHMENT_CACHE_KEY, JSON.stringify(cache));
  } catch { /* sessionStorage unavailable */ }
}

function getCachedAttachments(sessionId: string): Record<number, string[]> {
  try {
    const raw = sessionStorage.getItem(ATTACHMENT_CACHE_KEY);
    if (!raw) return {};
    const cache = JSON.parse(raw) as Record<string, Record<number, string[]>>;
    return cache[sessionId] ?? {};
  } catch { return {}; }
}

// ---------------------------------------------------------------------------
// SSE event type
// ---------------------------------------------------------------------------

interface SSEEvent {
  type: "text" | "text_delta" | "tool_use" | "tool_start" | "tool_result" | "error" | "done";
  content?: string;
  sessionId?: string;
  toolId?: string;
  toolInput?: unknown;
  toolOutput?: string;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [inputFocusSignal, setInputFocusSignal] = useState(0);
  const [displayMode, setDisplayMode] = useState<"sidebar" | "dialog">("sidebar");
  const [worktreePath, setWorktreePath] = useState<string | null>(null);

  // Chat state — lives here so it persists across route changes
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatStatus, setChatStatus] = useState<"idle" | "connecting" | "streaming" | "error">("idle");
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const msgsRef = useRef<ChatMessage[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Session management state
  const [sessions, setSessions] = useState<AssistantSession[]>([]);
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null);
  // Track whether the current session record has been created
  const sessionCreatedRef = useRef(false);

  const flushChat = useCallback(() => {
    setChatMessages([...msgsRef.current]);
  }, []);

  // Read config
  const refreshConfig = useCallback(async () => {
    const dm = await getConfigValue<string>("assistant.displayMode", "sidebar");
    setDisplayMode(dm === "dialog" ? "dialog" : "sidebar");
  }, []);

  useEffect(() => { refreshConfig(); }, [refreshConfig]);

  // Session list — enumerated from the durable on-disk SDK store (source of
  // truth), with the localStorage registry overlaid for user-renamed titles.
  // Listing from disk is what recovers conversations whose localStorage pointer
  // was lost (interrupted first turn, cleared storage, different origin, >cap).
  // Returns the resolved list so callers (mount hydration) can act on it.
  const refreshSessions = useCallback(async (): Promise<AssistantSession[]> => {
    const local = getSessions();
    try {
      const res = await fetch("/api/internal/assistant/sessions");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.sessions)) {
          const localTitle = new Map(local.map((s) => [s.id, s.title] as const));
          const merged: AssistantSession[] = (data.sessions as AssistantSession[]).map(
            (d) => {
              const overlay = localTitle.get(d.id);
              return overlay ? { ...d, title: overlay } : d;
            }
          );
          setSessions(merged);
          return merged;
        }
      }
    } catch {
      // Disk listing failed — fall back to the localStorage registry so the
      // dropdown still works offline / if the SDK import fails.
    }
    setSessions(local);
    return local;
  }, []);

  // Fetch history messages for a session from SDK via API
  const loadSessionHistory = useCallback(async (sessionId: string) => {
    setIsLoadingHistory(true);
    try {
      const res = await fetch(
        `/api/internal/assistant/sessions?sessionId=${encodeURIComponent(sessionId)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.messages)) {
        msgsRef.current = data.messages;
        // Restore attachmentFilenames from sessionStorage cache
        const attachmentCache = getCachedAttachments(sessionId);
        if (Object.keys(attachmentCache).length > 0) {
          let userIdx = 0;
          msgsRef.current = msgsRef.current.map((m) => {
            if (m.role === "user") {
              const filenames = attachmentCache[userIdx];
              userIdx++;
              if (filenames?.length) return { ...m, attachmentFilenames: filenames };
            }
            return m;
          });
        }
        setChatMessages([...msgsRef.current]);
      }
    } catch {
      // Silently fail — user can still send new messages
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  // Hydrate on mount from the durable on-disk store. The stored localStorage
  // pointer is only a hint: honor it when it still resolves to a real session,
  // otherwise fall back to the most-recent conversation on disk. This is what
  // restores history after a reload when the pointer was never written or was
  // lost (interrupted first turn, cleared storage, different origin, >cap) —
  // the conversations were always on disk; only the client index had drifted.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const merged = await refreshSessions();
      if (cancelled) return;
      const stored = getActiveSessionId();
      const chosen =
        stored && merged.some((s) => s.id === stored)
          ? stored
          : merged[0]?.id ?? null;
      if (!chosen) return;
      setActiveSessionIdState(chosen);
      sessionIdRef.current = chosen;
      // Mark as an existing session so the next message isn't mis-treated as a
      // first message (which would try to mint a new session record).
      sessionCreatedRef.current = true;
      setActiveSessionId(chosen);
      loadSessionHistory(chosen);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSessions, loadSessionHistory]);

  const createNewSession = useCallback(() => {
    abortRef.current?.abort();
    sessionIdRef.current = null;
    sessionCreatedRef.current = false;
    setActiveSessionIdState(null);
    setActiveSessionId(null);
    msgsRef.current = [];
    setChatMessages([]);
    setChatStatus("idle");
  }, []);

  const switchSession = useCallback((sessionId: string) => {
    abortRef.current?.abort();
    sessionIdRef.current = sessionId;
    sessionCreatedRef.current = true;
    setActiveSessionIdState(sessionId);
    setActiveSessionId(sessionId);
    // Clear then load history from SDK
    msgsRef.current = [];
    setChatMessages([]);
    setChatStatus("idle");
    loadSessionHistory(sessionId);
  }, [loadSessionHistory]);

  const removeSession = useCallback((sessionId: string) => {
    // Optimistic: drop the localStorage overlay + list entry for a snappy UI.
    deleteSession(sessionId);
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (activeSessionId === sessionId) {
      createNewSession();
    }
    // Durable delete from the on-disk store — otherwise disk-as-truth would
    // resurrect the session on the next list/hydrate. Reconcile after it lands.
    void fetch(
      `/api/internal/assistant/sessions?sessionId=${encodeURIComponent(sessionId)}`,
      { method: "DELETE" }
    )
      .catch(() => {})
      .finally(() => {
        void refreshSessions();
      });
  }, [activeSessionId, createNewSession, refreshSessions]);

  const renameSession = useCallback((sessionId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    // Optimistic overlay update.
    updateSession(sessionId, { title: trimmed });
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, title: trimmed } : s))
    );
    // Persist to the on-disk store (customTitle) so the rename survives
    // localStorage loss / a different origin.
    void fetch(
      `/api/internal/assistant/sessions?sessionId=${encodeURIComponent(sessionId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      }
    ).catch(() => {});
  }, []);

  const openAssistant = useCallback(async () => {
    setIsStarting(true);
    try {
      await refreshConfig();
      setIsOpen(true);
    } finally {
      setIsStarting(false);
    }
  }, [refreshConfig]);

  const closeAssistant = useCallback(() => {
    setIsOpen(false);
    // Abort any in-flight chat request — and settle status to idle so reopening
    // the panel doesn't show a stuck "thinking" state for a turn that's gone.
    abortRef.current?.abort();
    abortRef.current = null;
    setChatStatus("idle");
  }, []);

  const toggleAssistant = useCallback(() => {
    if (isOpen || isStarting) {
      closeAssistant();
    } else {
      openAssistant();
    }
  }, [isOpen, isStarting, closeAssistant, openAssistant]);

  // Move focus into the assistant input. If the panel is closed, open it — the
  // freshly-mounted chat auto-focuses its textarea on mount. If it's already
  // open, bump a signal the mounted chat watches to (re)focus the input.
  const focusAssistantInput = useCallback(() => {
    if (isOpen || isStarting) {
      setInputFocusSignal((n) => n + 1);
    } else {
      void openAssistant();
    }
  }, [isOpen, isStarting, openAssistant]);

  // Keyboard shortcut: toggle the AI assistant (default ⌘L / Ctrl+L).
  useActionShortcut("global.assistant", () => toggleAssistant());

  // Keyboard shortcut: jump focus into the assistant input (default Ctrl+').
  useActionShortcut("global.focusAssistant", () => focusAssistantInput());

  // -------------------------------------------------------------------------
  // Chat message sender — lives at provider level for persistence
  // -------------------------------------------------------------------------
  const sendChatMessage = useCallback(async (text: string, options?: { attachmentFilenames?: string[] }) => {
    if (!text.trim() && !(options?.attachmentFilenames?.length)) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Capture the first message text for session title
    const isFirstMessage = msgsRef.current.length === 0 && !sessionCreatedRef.current;
    const firstMessageText = isFirstMessage ? text : null;

    const thinkingId = nextId();
    msgsRef.current = [
      ...msgsRef.current,
      {
        id: nextId(),
        role: "user" as MessageRole,
        content: text,
        attachmentFilenames: options?.attachmentFilenames?.length ? options.attachmentFilenames : undefined,
      },
      { id: thinkingId, role: "thinking" as MessageRole, content: "", isStreaming: true },
    ];
    flushChat();
    // Cache attachmentFilenames so they survive session reload
    if (options?.attachmentFilenames?.length && sessionIdRef.current) {
      const userMsgCount = msgsRef.current.filter((m) => m.role === "user").length - 1;
      cacheMessageAttachments(sessionIdRef.current, userMsgCount, options.attachmentFilenames);
    }
    setChatStatus("connecting");

    let assistantMsgId: string | null = null;

    try {
      const res = await fetch("/api/internal/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          sessionId: sessionIdRef.current,
          attachmentFilenames: options?.attachmentFilenames ?? [],
        }),
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
          if (event.sessionId) {
            const prevSessionId = sessionIdRef.current;
            sessionIdRef.current = event.sessionId;
            // Create session record on first sessionId received
            if (firstMessageText && !sessionCreatedRef.current && event.sessionId !== prevSessionId) {
              sessionCreatedRef.current = true;
              const now = new Date().toISOString();
              const newSession: AssistantSession = {
                id: event.sessionId,
                title: buildSessionTitle(firstMessageText),
                createdAt: now,
                updatedAt: now,
              };
              addSession(newSession);
              setSessions(getSessions());
              setActiveSessionIdState(event.sessionId);
              setActiveSessionId(event.sessionId);
              // Migrate cached images from the pre-session (null) key to the real sessionId
              if (options?.attachmentFilenames?.length) {
                cacheMessageAttachments(event.sessionId, 0, options.attachmentFilenames);
              }
            }
          }

          switch (event.type) {
            case "text_delta": {
              // Incremental streaming chunk — append to current assistant message
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
            case "text": {
              // Complete message block — replace/finalize the assistant message
              const filtered = msgsRef.current.filter((m) => m.id !== thinkingId);
              if (assistantMsgId) {
                // If we already have streaming content, finalize it rather than replace
                msgsRef.current = filtered.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, content: event.content ?? m.content, isStreaming: true }
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
            case "tool_start": {
              // 调起 — placeholder card while the tool's input streams in. The
              // real 真正调用 (tool_use) arrives next and upgrades THIS card in
              // place (matched by toolId), so a single call renders as one card.
              const filtered = msgsRef.current.filter((m) => m.id !== thinkingId);
              if (assistantMsgId) {
                msgsRef.current = filtered.map((m) =>
                  m.id === assistantMsgId ? { ...m, isStreaming: false } : m
                );
                assistantMsgId = null;
              } else {
                msgsRef.current = filtered;
              }
              // Defensive de-dupe: never create a second placeholder for a
              // toolId we already have a card for.
              const dupe = event.toolId
                ? msgsRef.current.some((m) => m.role === "tool" && m.toolId === event.toolId)
                : false;
              if (!dupe) {
                msgsRef.current = [...msgsRef.current, {
                  id: nextId(), role: "tool" as MessageRole,
                  content: `Calling ${event.content ?? "tool"}...`,
                  toolName: event.content,
                  toolId: event.toolId,
                  isStreaming: true,
                }];
              }
              flushChat();
              break;
            }
            case "tool_use": {
              // 真正调用 — full input. Upgrade the matching 调起 placeholder
              // rather than appending a duplicate. Match by toolId; fall back to
              // the most recent streaming placeholder with the same name when no
              // id is present.
              const filtered = msgsRef.current.filter((m) => m.id !== thinkingId);
              const updated = assistantMsgId
                ? filtered.map((m) => m.id === assistantMsgId ? { ...m, isStreaming: false } : m)
                : filtered;
              assistantMsgId = null;

              const jsonInput = JSON.stringify(event.toolInput ?? {}, null, 2);
              let matchIdx = -1;
              if (event.toolId) {
                matchIdx = updated.findIndex(
                  (m) => m.role === "tool" && m.toolId === event.toolId
                );
              }
              if (matchIdx === -1) {
                for (let i = updated.length - 1; i >= 0; i--) {
                  const m = updated[i];
                  if (m.role === "tool" && m.isStreaming && m.toolName === event.content) {
                    matchIdx = i;
                    break;
                  }
                }
              }

              if (matchIdx !== -1) {
                msgsRef.current = updated.map((m, i) =>
                  i === matchIdx
                    ? { ...m, content: jsonInput, toolName: event.content, toolId: event.toolId ?? m.toolId, isStreaming: false }
                    : m
                );
              } else {
                msgsRef.current = [...updated, {
                  id: nextId(), role: "tool" as MessageRole,
                  content: jsonInput,
                  toolName: event.content,
                  toolId: event.toolId,
                  isStreaming: false,
                }];
              }
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
              // Finalize: drop the thinking indicator and clear any lingering
              // streaming flag (assistant text AND tool placeholders) so nothing
              // is left visually "in progress" after the turn ends.
              msgsRef.current = msgsRef.current
                .filter((m) => m.id !== thinkingId)
                .map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m));
              assistantMsgId = null;
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
      // Refresh session list from SDK (picks up newly created sessions)
      refreshSessions();
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") return;
      msgsRef.current = [...msgsRef.current.filter((m) => m.id !== thinkingId), {
        id: nextId(), role: "assistant" as MessageRole,
        content: `Connection error: ${(err as Error).message ?? "Unknown error"}`,
      }];
      flushChat();
      setChatStatus("error");
    }
  }, [flushChat, refreshSessions]);

  // Cancel the in-flight request but PRESERVE completed records. Stopping must
  // not discard work already done — e.g. a task the assistant already created,
  // its tool card, and any text it streamed. We only drop the transient
  // "thinking" indicator and clear the streaming flag on whatever was mid-flight
  // so it settles as a finished bubble. Returns null: nothing is restored to the
  // input box because the conversation (incl. the user message) stays in place.
  const cancelChat = useCallback((): string | null => {
    abortRef.current?.abort();
    abortRef.current = null;

    msgsRef.current = msgsRef.current
      .filter((m) => m.role !== "thinking")
      .map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m));
    setChatMessages([...msgsRef.current]);

    setChatStatus("idle");
    return null;
  }, []);

  const lastMsg = chatMessages[chatMessages.length - 1];
  const isChatThinking =
    chatStatus === "connecting" || chatStatus === "streaming" ||
    (lastMsg?.role === "thinking" && lastMsg.isStreaming === true);

  return (
    <AssistantContext.Provider
      value={{
        isOpen, isStarting, displayMode, worktreePath,
        toggleAssistant, closeAssistant, focusAssistantInput, inputFocusSignal,
        chatMessages, chatStatus, isChatThinking, isLoadingHistory, sendChatMessage, cancelChat,
        sessions, activeSessionId, createNewSession, switchSession, removeSession, renameSession, refreshSessions,
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

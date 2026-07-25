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
import type { ChatMessage, MessageRole } from "@/hooks/use-assistant-chat";
import {
  type AssistantSession,
  type SessionBinding,
  getActiveSessionId,
  setActiveSessionId,
  readLegacyAssistantOverlay,
  clearLegacyAssistantOverlay,
} from "@/lib/assistant-sessions";
import { getWorkspacesWithProjects } from "@/actions/workspace-actions";

/** Cascading workspace → project options for the binding dropdowns. */
export interface WorkspaceTreeItem {
  id: string;
  name: string;
  projects: { id: string; name: string; alias: string | null }[];
}

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
  /** Bumped to request the chat input take focus while already mounted. */
  inputFocusSignal: number;
  // Chat state — persisted at provider level so it survives route changes
  chatMessages: ChatMessage[];
  chatStatus: "idle" | "connecting" | "streaming" | "error";
  isChatThinking: boolean;
  isLoadingHistory: boolean;
  sendChatMessage: (text: string, options?: { attachmentFilenames?: string[] }) => void;
  cancelChat: () => string | null;
  // Session default scope binding (soft default — global requests ignore it)
  binding: SessionBinding;
  setSessionBinding: (binding: SessionBinding) => void;
  workspaceTree: WorkspaceTreeItem[];
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
// SSE event type
// ---------------------------------------------------------------------------

interface SSEEvent {
  type: "session" | "text" | "text_delta" | "reasoning_delta" | "tool_use" | "tool_start" | "tool_result" | "usage" | "finish" | "error" | "done";
  content?: string;
  sessionId?: string;
  toolId?: string;
  toolInput?: unknown;
  toolOutput?: string;
  code?: string;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [inputFocusSignal, setInputFocusSignal] = useState(0);
  const [displayMode, setDisplayMode] = useState<"sidebar" | "dialog">("sidebar");
  const worktreePath: string | null = null;

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
  const legacyOverlayAppliedRef = useRef(false);

  // Session default scope binding. `binding` drives the dropdowns; `bindingRef`
  // mirrors it so the sendChatMessage closure reads the latest selection without
  // being re-created on every change. `workspaceTree` feeds the cascading menus.
  const [binding, setBindingState] = useState<SessionBinding>({});
  const bindingRef = useRef<SessionBinding>({});
  useEffect(() => { bindingRef.current = binding; }, [binding]);
  const [workspaceTree, setWorkspaceTree] = useState<WorkspaceTreeItem[]>([]);

  useEffect(() => {
    getWorkspacesWithProjects()
      .then((tree) => setWorkspaceTree(tree as WorkspaceTreeItem[]))
      .catch(() => { /* dropdowns just stay empty */ });
  }, []);

  const setSessionBinding = useCallback((next: SessionBinding) => {
    setBindingState(next);
    const sid = sessionIdRef.current;
    if (sid) {
      void fetch(`/api/internal/assistant/sessions?sessionId=${encodeURIComponent(sid)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: next.workspaceId ?? null,
          workspaceName: next.workspaceName ?? null,
          projectId: next.projectId ?? null,
          projectName: next.projectName ?? null,
          versionId: next.versionId ?? null,
          versionName: next.versionName ?? null,
        }),
      }).then(async (response) => {
        if (!response.ok) throw new Error("binding_update_failed");
        const data = await response.json();
        if (data.sessionId && data.sessionId !== sid) {
          sessionIdRef.current = data.sessionId;
          setActiveSessionIdState(data.sessionId);
          setActiveSessionId(data.sessionId);
        }
      }).catch(() => toast.error("Failed to save Assistant scope"));
    }
  }, []);

  const flushChat = useCallback(() => {
    setChatMessages([...msgsRef.current]);
  }, []);

  // Read config
  const refreshConfig = useCallback(async () => {
    const dm = await getConfigValue<string>("assistant.displayMode", "sidebar");
    setDisplayMode(dm === "dialog" ? "dialog" : "sidebar");
  }, []);

  useEffect(() => { refreshConfig(); }, [refreshConfig]);

  const refreshSessions = useCallback(async (): Promise<AssistantSession[]> => {
    try {
      const res = await fetch("/api/internal/assistant/sessions");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.sessions)) {
          let authoritative = data.sessions as AssistantSession[];
          if (!legacyOverlayAppliedRef.current) {
            legacyOverlayAppliedRef.current = true;
            const overlay = readLegacyAssistantOverlay();
            const localById = new Map(overlay.sessions.map((session) => [session.id, session]));
            const migrations = authoritative.flatMap((session) => {
              const local = localById.get(session.id);
              const savedBinding = overlay.bindings[session.id];
              if (!local && !savedBinding) return [];
              return [fetch(`/api/internal/assistant/sessions?sessionId=${encodeURIComponent(session.id)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...(local?.title ? { title: local.title } : {}),
                  ...(savedBinding ?? {}),
                }),
              })];
            });
            if (migrations.length) {
              const results = await Promise.allSettled(migrations);
              if (results.every((result) => result.status === "fulfilled" && result.value.ok)) {
                clearLegacyAssistantOverlay();
                const refreshed = await fetch("/api/internal/assistant/sessions");
                if (refreshed.ok) authoritative = (await refreshed.json()).sessions as AssistantSession[];
              } else {
                legacyOverlayAppliedRef.current = false;
              }
            } else {
              clearLegacyAssistantOverlay();
            }
          }
          setSessions(authoritative);
          return authoritative;
        }
      }
    } catch {
      // Keep the last DB-backed list on transient failures.
    }
    return [];
  }, []);

  const loadSessionHistory = useCallback(async (sessionId: string) => {
    setIsLoadingHistory(true);
    try {
      const res = await fetch(
        `/api/internal/assistant/sessions?sessionId=${encodeURIComponent(sessionId)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      const resolvedSessionId = typeof data.sessionId === "string" ? data.sessionId : sessionId;
      if (resolvedSessionId !== sessionId) {
        sessionIdRef.current = resolvedSessionId;
        setActiveSessionIdState(resolvedSessionId);
        setActiveSessionId(resolvedSessionId);
      }
      if (data.session) {
        setBindingState({
          ...(data.session.workspaceId ? { workspaceId: data.session.workspaceId } : {}),
          ...(data.session.workspaceName ? { workspaceName: data.session.workspaceName } : {}),
          ...(data.session.projectId ? { projectId: data.session.projectId } : {}),
          ...(data.session.projectName ? { projectName: data.session.projectName } : {}),
          ...(data.session.versionId ? { versionId: data.session.versionId } : {}),
          ...(data.session.versionName ? { versionName: data.session.versionName } : {}),
        });
      }
      if (Array.isArray(data.messages)) {
        msgsRef.current = data.messages;
        setChatMessages([...msgsRef.current]);
      }
      if (resolvedSessionId !== sessionId) void refreshSessions();
    } catch {
      // Silently fail — user can still send new messages
    } finally {
      setIsLoadingHistory(false);
    }
  }, [refreshSessions]);

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
      setActiveSessionId(chosen);
      const selected = merged.find((session) => session.id === chosen);
      setBindingState(selected ? {
        ...(selected.workspaceId ? { workspaceId: selected.workspaceId } : {}),
        ...(selected.workspaceName ? { workspaceName: selected.workspaceName } : {}),
        ...(selected.projectId ? { projectId: selected.projectId } : {}),
        ...(selected.projectName ? { projectName: selected.projectName } : {}),
        ...(selected.versionId ? { versionId: selected.versionId } : {}),
        ...(selected.versionName ? { versionName: selected.versionName } : {}),
      } : {});
      loadSessionHistory(chosen);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSessions, loadSessionHistory]);

  const createNewSession = useCallback(() => {
    abortRef.current?.abort();
    sessionIdRef.current = null;
    setActiveSessionIdState(null);
    setActiveSessionId(null);
    // A fresh session starts with no scope — the user picks one if they want.
    setBindingState({});
    msgsRef.current = [];
    setChatMessages([]);
    setChatStatus("idle");
  }, []);

  const switchSession = useCallback((sessionId: string) => {
    abortRef.current?.abort();
    sessionIdRef.current = sessionId;
    setActiveSessionIdState(sessionId);
    setActiveSessionId(sessionId);
    const selected = sessions.find((session) => session.id === sessionId);
    setBindingState(selected ? {
      ...(selected.workspaceId ? { workspaceId: selected.workspaceId } : {}),
      ...(selected.workspaceName ? { workspaceName: selected.workspaceName } : {}),
      ...(selected.projectId ? { projectId: selected.projectId } : {}),
      ...(selected.projectName ? { projectName: selected.projectName } : {}),
      ...(selected.versionId ? { versionId: selected.versionId } : {}),
      ...(selected.versionName ? { versionName: selected.versionName } : {}),
    } : {});
    msgsRef.current = [];
    setChatMessages([]);
    setChatStatus("idle");
    loadSessionHistory(sessionId);
  }, [loadSessionHistory, sessions]);

  const removeSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (activeSessionId === sessionId) {
      createNewSession();
    }
    void fetch(
      `/api/internal/assistant/sessions?sessionId=${encodeURIComponent(sessionId)}`,
      { method: "DELETE" }
    )
      .then((response) => {
        if (!response.ok) throw new Error("session_delete_failed");
      })
      .catch(() => toast.error("Failed to delete Assistant session"))
      .finally(() => {
        void refreshSessions();
      });
  }, [activeSessionId, createNewSession, refreshSessions]);

  const renameSession = useCallback((sessionId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, title: trimmed } : s))
    );
    void fetch(
      `/api/internal/assistant/sessions?sessionId=${encodeURIComponent(sessionId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      }
    ).then((response) => {
      if (!response.ok) throw new Error("session_rename_failed");
      return response.json();
    }).then((data) => {
      if (data.sessionId && data.sessionId !== sessionId) {
        sessionIdRef.current = data.sessionId;
        setActiveSessionIdState(data.sessionId);
        setActiveSessionId(data.sessionId);
      }
      if (data.legacySyncWarning) toast.warning("Title saved, but the legacy session could not be renamed");
    }).catch(() => {
      toast.error("Failed to rename Assistant session");
      void refreshSessions();
    });
  }, [refreshSessions]);

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

  // Smart toggle (default ⌘L / Ctrl+L):
  //  - closed        → open (the freshly-mounted chat auto-focuses its input)
  //  - open, unfocused → move focus into the input (don't make the user re-open)
  //  - open, focused   → close
  // The middle case is the fix: previously ⌘L just closed, so getting from a
  // mission pane into the assistant input took two presses.
  const toggleAssistant = useCallback(() => {
    if (!isOpen && !isStarting) {
      void openAssistant();
      return;
    }
    const active = document.activeElement;
    const inputFocused = active instanceof HTMLElement
      && active.closest("[data-assistant-input]") !== null;
    if (inputFocused) {
      closeAssistant();
    } else {
      setInputFocusSignal((n) => n + 1);
    }
  }, [isOpen, isStarting, closeAssistant, openAssistant]);

  // Keyboard shortcut: toggle the AI assistant (default ⌘L / Ctrl+L).
  useActionShortcut("global.assistant", () => toggleAssistant());

  // -------------------------------------------------------------------------
  // Chat message sender — lives at provider level for persistence
  // -------------------------------------------------------------------------
  const sendChatMessage = useCallback(async (text: string, options?: { attachmentFilenames?: string[] }) => {
    if (!text.trim() && !(options?.attachmentFilenames?.length)) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

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
    setChatStatus("connecting");

    let assistantMsgId: string | null = null;

    try {
      const res = await fetch("/api/internal/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          sessionId: sessionIdRef.current,
          clientTurnId: nextId().replace(/[^A-Za-z0-9_-]/g, "_"),
          attachmentFilenames: options?.attachmentFilenames ?? [],
          // Session default scope — sent every turn so a mid-session switch takes
          // effect immediately. Empty binding → fields undefined → backend no-op.
          workspaceId: bindingRef.current.workspaceId,
          workspaceName: bindingRef.current.workspaceName,
          projectId: bindingRef.current.projectId,
          projectName: bindingRef.current.projectName,
          versionId: bindingRef.current.versionId,
          versionName: bindingRef.current.versionName,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const payload = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? `HTTP ${res.status}`);
      }
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
            const changed = event.sessionId !== sessionIdRef.current;
            sessionIdRef.current = event.sessionId;
            if (changed) {
              setActiveSessionIdState(event.sessionId);
              setActiveSessionId(event.sessionId);
              void refreshSessions();
            }
          }

          switch (event.type) {
            case "session":
            case "reasoning_delta":
            case "usage":
            case "finish":
              break;
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
              const resultText = String(event.toolOutput ?? "");
              const matchIdx = event.toolId
                ? msgsRef.current.findIndex((message) => message.role === "tool" && message.toolId === event.toolId)
                : -1;
              if (matchIdx >= 0) {
                msgsRef.current = msgsRef.current.map((message, index) => index === matchIdx ? {
                  ...message,
                  content: `${message.content}\n\nResult:\n${resultText}`,
                  isStreaming: false,
                } : message);
              } else {
                msgsRef.current = [...msgsRef.current, {
                  id: nextId(), role: "tool" as MessageRole,
                  content: resultText,
                  toolName: event.content ?? "tool",
                  toolId: event.toolId,
                }];
              }
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
      void refreshSessions();
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
        toggleAssistant, closeAssistant, inputFocusSignal,
        chatMessages, chatStatus, isChatThinking, isLoadingHistory, sendChatMessage, cancelChat,
        binding, setSessionBinding, workspaceTree,
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

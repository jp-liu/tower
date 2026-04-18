"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { getConfigValue } from "@/actions/config-actions";
import { ASSISTANT_SESSION_KEY } from "@/lib/assistant-constants";

interface AssistantContextValue {
  isOpen: boolean;
  isStarting: boolean;
  displayMode: "sidebar" | "dialog";
  communicationMode: "terminal" | "chat";
  worktreePath: string | null;
  toggleAssistant: () => void;
  closeAssistant: () => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [displayMode, setDisplayMode] = useState<"sidebar" | "dialog">("sidebar");
  const [communicationMode, setCommunicationMode] = useState<"terminal" | "chat">("terminal");
  const [worktreePath, setWorktreePath] = useState<string | null>(null);

  // Read display mode and communication mode from config
  const refreshConfig = useCallback(async () => {
    const [dm, cm] = await Promise.all([
      getConfigValue<string>("assistant.displayMode", "sidebar"),
      getConfigValue<string>("assistant.communicationMode", "terminal"),
    ]);
    setDisplayMode(dm === "dialog" ? "dialog" : "sidebar");
    setCommunicationMode(cm === "chat" ? "chat" : "terminal");
  }, []);

  // Initial config load
  useEffect(() => { refreshConfig(); }, [refreshConfig]);

  const openAssistant = useCallback(async () => {
    setIsStarting(true);
    try {
      // Re-read config before opening so Settings changes take effect immediately
      await refreshConfig();

      // Chat mode uses Agent SDK (no PTY needed) — just open the panel
      const latestCommMode = await getConfigValue<string>("assistant.communicationMode", "terminal");
      if (latestCommMode === "chat") {
        setIsOpen(true);
        return;
      }

      // Terminal mode: create PTY session
      const res = await fetch("/api/internal/assistant", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Unknown error");
      }
      // Use session key as sentinel — TaskTerminal guards on non-null worktreePath
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
    // Only destroy PTY session for terminal mode
    if (worktreePath) {
      setWorktreePath(null);
      fetch("/api/internal/assistant", { method: "DELETE" }).catch(() => {});
    }
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
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [toggleAssistant]);

  return (
    <AssistantContext.Provider
      value={{ isOpen, isStarting, displayMode, communicationMode, worktreePath, toggleAssistant, closeAssistant }}
    >
      {children}
    </AssistantContext.Provider>
  );
}

export function useAssistant(): AssistantContextValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) {
    throw new Error("useAssistant must be used within an AssistantProvider");
  }
  return ctx;
}

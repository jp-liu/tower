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

interface AssistantContextValue {
  isOpen: boolean;
  isStarting: boolean;
  displayMode: "sidebar" | "dialog";
  worktreePath: string | null;
  toggleAssistant: () => void;
  closeAssistant: () => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [displayMode, setDisplayMode] = useState<"sidebar" | "dialog">("sidebar");
  const [worktreePath, setWorktreePath] = useState<string | null>(null);

  // Read display mode from config on mount
  useEffect(() => {
    getConfigValue<string>("assistant.displayMode", "sidebar").then((mode) => {
      setDisplayMode(mode === "dialog" ? "dialog" : "sidebar");
    });
  }, []);

  const openAssistant = useCallback(async () => {
    setIsStarting(true);
    try {
      const res = await fetch("/api/internal/assistant", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Unknown error");
      }
      setWorktreePath(data.worktreePath ?? null);
      setIsOpen(true);
    } catch {
      toast.error("Session failed to start. Try again.");
    } finally {
      setIsStarting(false);
    }
  }, []);

  const closeAssistant = useCallback(() => {
    setIsOpen(false);
    setWorktreePath(null);
    // Fire-and-forget
    fetch("/api/internal/assistant", { method: "DELETE" }).catch(() => {});
  }, []);

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
      value={{ isOpen, isStarting, displayMode, worktreePath, toggleAssistant, closeAssistant }}
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

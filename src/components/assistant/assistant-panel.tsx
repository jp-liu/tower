"use client";

import dynamic from "next/dynamic";
import { Bot, ChevronDown, Loader2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ASSISTANT_SESSION_KEY } from "@/lib/assistant-constants";
import { useAssistant } from "./assistant-provider";
import { useI18n } from "@/lib/i18n";

interface AssistantPanelProps {
  mode: "sidebar" | "dialog";
}

const DynamicTerminal = dynamic(
  () =>
    import("@/components/task/task-terminal").then((m) => ({
      default: m.TaskTerminal,
    })),
  { ssr: false }
);

const DynamicChat = dynamic(
  () => import("./assistant-chat").then((m) => ({ default: m.AssistantChat })),
  { ssr: false }
);

/**
 * Format a date string as relative time (e.g. "2 hours ago").
 */
function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function AssistantPanel({ mode }: AssistantPanelProps) {
  const {
    isOpen,
    isStarting,
    worktreePath,
    communicationMode,
    closeAssistant,
    sessions,
    activeSessionId,
    createNewSession,
    switchSession,
    removeSession,
  } = useAssistant();
  const { t } = useI18n();

  const containerClass =
    mode === "sidebar"
      ? "min-w-[320px] max-w-[480px] w-[30vw] shrink-0 border-r border-border flex flex-col bg-popover overflow-hidden"
      : "flex flex-col h-full overflow-hidden";

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeTitle = activeSession?.title ?? t("assistant.newSession");

  return (
    <div className={containerClass}>
      {/* Title bar */}
      <div className="h-[44px] border-b border-border flex items-center px-4 gap-2 bg-popover">
        <Bot className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-semibold text-foreground shrink-0">{t("assistant.title")}</span>

        {communicationMode === "chat" && (
          <>
            <div className="flex-1" />
            {/* Session selector dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex items-center gap-1 h-8 px-2 rounded-md text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground max-w-[120px] truncate"
                aria-label={t("assistant.sessionList")}
              >
                <span className="truncate">{activeTitle}</span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="bottom" align="end" sideOffset={4}>
                {sessions.length === 0 ? (
                  <div className="px-2 py-4 text-xs text-muted-foreground text-center">
                    {t("assistant.noSessions")}
                  </div>
                ) : (
                  sessions.map((session) => (
                    <DropdownMenuItem
                      key={session.id}
                      className="flex items-center justify-between gap-2 pr-1"
                      onClick={() => switchSession(session.id)}
                    >
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-xs truncate max-w-[140px]">{session.title}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatRelativeTime(session.updatedAt)}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        className="h-6 w-6 p-0 shrink-0 opacity-50 hover:opacity-100 hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeSession(session.id);
                        }}
                        aria-label={t("assistant.deleteSession")}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </DropdownMenuItem>
                  ))
                )}
                {sessions.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem onClick={createNewSession}>
                  <Plus className="h-3 w-3 mr-1" />
                  <span className="text-xs">{t("assistant.newSession")}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* New session button */}
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground"
              onClick={createNewSession}
              aria-label={t("assistant.newSession")}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </>
        )}

        {communicationMode !== "chat" && <div className="flex-1" />}

        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground"
          onClick={closeAssistant}
          aria-label={t("assistant.closeLabel")}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {communicationMode === "chat" ? (
          /* Chat mode: uses Agent SDK via SSE — no PTY session needed */
          isOpen ? <DynamicChat /> : null
        ) : isStarting ? (
          <div className="flex h-full items-center justify-center bg-popover">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{t("assistant.starting")}</span>
            </div>
          </div>
        ) : isOpen && !isStarting && worktreePath ? (
          /* Terminal mode: uses PTY session via WebSocket */
          <DynamicTerminal
            taskId={ASSISTANT_SESSION_KEY}
            worktreePath={worktreePath}
          />
        ) : null}
      </div>
    </div>
  );
}

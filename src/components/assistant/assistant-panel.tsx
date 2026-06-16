"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Bot, ChevronDown, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAssistant } from "./assistant-provider";
import { useI18n } from "@/lib/i18n";

interface AssistantPanelProps {
  mode: "sidebar" | "dialog";
}

const DynamicChat = dynamic(
  () => import("./assistant-chat").then((m) => ({ default: m.AssistantChat })),
  { ssr: false }
);

/**
 * Format a date string as relative time (e.g. "2h ago").
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
    closeAssistant,
    sessions,
    activeSessionId,
    createNewSession,
    switchSession,
    removeSession,
    renameSession,
  } = useAssistant();
  const { t } = useI18n();

  // Rename dialog state
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const openRenameDialog = (id: string, currentTitle: string) => {
    setRenameTarget({ id, title: currentTitle });
    setRenameValue(currentTitle);
  };

  const closeRenameDialog = () => {
    setRenameTarget(null);
    setRenameValue("");
  };

  const confirmRename = () => {
    if (!renameTarget || !renameValue.trim()) return;
    renameSession(renameTarget.id, renameValue);
    closeRenameDialog();
  };

  const containerClass =
    mode === "sidebar"
      ? "min-w-[320px] max-w-[480px] w-[30vw] shrink-0 border-r border-border flex flex-col bg-sidebar overflow-hidden"
      : "flex flex-col h-full overflow-hidden";

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeTitle = activeSession?.title ?? t("assistant.newSession");

  return (
    <div className={containerClass}>
      {/* Title bar */}
      <div className="header-sm flex items-center px-4 gap-2 bg-sidebar">
        <Bot className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-semibold text-foreground shrink-0">{t("assistant.title")}</span>

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
              <DropdownMenuContent side="bottom" align="end" sideOffset={4} className="w-[280px]">
                {sessions.length === 0 ? (
                  <div className="px-2 py-4 text-xs text-muted-foreground text-center">
                    {t("assistant.noSessions")}
                  </div>
                ) : (
                  sessions.map((session) => (
                    <DropdownMenuItem
                      key={session.id}
                      className="flex items-center justify-between gap-1 pr-1"
                      onClick={() => switchSession(session.id)}
                    >
                      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                        <span className="text-xs truncate">{session.title}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatRelativeTime(session.updatedAt)}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        className="h-6 w-6 p-0 shrink-0 opacity-50 hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          openRenameDialog(session.id, session.title);
                        }}
                        aria-label={t("assistant.renameSession")}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
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

      {/* Body — chat only */}
      <div className="flex-1 overflow-hidden">
        {isOpen ? <DynamicChat /> : null}
      </div>

      {/* Rename session dialog */}
      <Dialog open={renameTarget !== null} onOpenChange={(open) => { if (!open) closeRenameDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("assistant.renameSessionTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                confirmRename();
              }
            }}
            placeholder={t("assistant.renameSessionPlaceholder")}
          />
          <DialogFooter>
            <Button variant="outline" onClick={closeRenameDialog}>
              {t("common.cancel")}
            </Button>
            <Button onClick={confirmRename} disabled={!renameValue.trim()}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

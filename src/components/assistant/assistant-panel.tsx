"use client";

import dynamic from "next/dynamic";
import { Bot, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ASSISTANT_SESSION_KEY } from "@/lib/assistant-constants";
import { useAssistant } from "./assistant-provider";

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

export function AssistantPanel({ mode }: AssistantPanelProps) {
  const { isOpen, isStarting, worktreePath, closeAssistant } = useAssistant();

  const containerClass =
    mode === "sidebar"
      ? "w-[420px] shrink-0 border-r border-border flex flex-col bg-popover overflow-hidden"
      : "flex flex-col h-full overflow-hidden";

  return (
    <div className={containerClass}>
      {/* Title bar */}
      <div className="h-[44px] border-b border-border flex items-center px-4 gap-2 bg-popover">
        <Bot className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">Tower Assistant</span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          className="h-8 w-8 p-0"
          onClick={closeAssistant}
          aria-label="Close assistant"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Terminal body */}
      <div className="flex-1 overflow-hidden">
        {isStarting ? (
          <div className="flex h-full items-center justify-center bg-popover">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Starting...</span>
            </div>
          </div>
        ) : isOpen && !isStarting && worktreePath ? (
          <DynamicTerminal
            taskId={ASSISTANT_SESSION_KEY}
            worktreePath={worktreePath}
          />
        ) : null}
      </div>
    </div>
  );
}

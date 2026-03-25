"use client";

import { useState, useCallback } from "react";
import { Send, Paperclip, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface TaskMessageInputProps {
  onSend: (message: string) => void;
  isLoading?: boolean;
  fileChanges?: { added: number; removed: number };
  agentName?: string;
}

const MODES = [
  { id: "default", label: "Default" },
  { id: "plan", label: "Plan" },
  { id: "code", label: "Code" },
];

export function TaskMessageInput({
  onSend,
  isLoading = false,
  fileChanges = { added: 0, removed: 0 },
  agentName = "Claude Code",
}: TaskMessageInputProps) {
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState("default");
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const handleSend = useCallback(() => {
    if (!message.trim() || isLoading) return;
    onSend(message.trim());
    setMessage("");
  }, [message, isLoading, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const currentMode = MODES.find((m) => m.id === mode) ?? MODES[0];

  return (
    <div className="relative border-t border-border bg-card/50">
      {/* Toast */}
      {toast && (
        <div className="absolute -top-10 left-4 right-4 z-10 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
          {toast}
        </div>
      )}

      {/* File changes + agent indicator */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-1.5">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{fileChanges.added + fileChanges.removed} 个文件已更改</span>
          <span className="font-mono text-emerald-400">+{fileChanges.added}</span>
          <span className="font-mono text-rose-400">-{fileChanges.removed}</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="font-medium text-foreground/80">{agentName}</span>
        </div>
      </div>

      {/* Input area */}
      <div className="p-3">
        <textarea
          placeholder="输入指令..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          className="w-full resize-none bg-transparent text-sm text-foreground placeholder-muted-foreground/50 outline-none"
          disabled={isLoading}
        />

        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button className="inline-flex items-center rounded-md border border-border bg-muted/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" />
                }
              >
                {currentMode.label}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {MODES.map((m) => (
                  <DropdownMenuItem key={m.id} onClick={() => setMode(m.id)}>
                    {m.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              onClick={() => showToast("附件功能开发中")}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="添加附件"
            >
              <Paperclip className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => showToast("工具功能开发中")}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="工具"
            >
              <Wrench className="h-3.5 w-3.5" />
            </button>
          </div>
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!message.trim() || isLoading}
            className="h-7 gap-1.5 bg-amber-500/15 px-3 text-xs text-amber-300 ring-1 ring-amber-500/25 hover:bg-amber-500/25 disabled:opacity-30"
          >
            <Send className="h-3 w-3" />
            {isLoading ? "处理中..." : "发送"}
          </Button>
        </div>
      </div>
    </div>
  );
}

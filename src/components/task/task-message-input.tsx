"use client";

import { useState, useCallback } from "react";
import { Paperclip, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
    <div className="relative border-t bg-white">
      {/* Toast */}
      {toast && (
        <div className="absolute -top-10 left-4 right-4 z-10 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-1.5 text-xs text-yellow-700 shadow-sm">
          {toast}
        </div>
      )}

      {/* File changes + agent indicator */}
      <div className="flex items-center justify-between border-b px-4 py-1.5">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>
            {fileChanges.added + fileChanges.removed} 个文件已更改
          </span>
          <span className="text-green-500">+{fileChanges.added}</span>
          <span className="text-red-500">-{fileChanges.removed}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <div className="h-1.5 w-1.5 rounded-full bg-green-400" />
          <span className="font-medium">{agentName}</span>
          <span className="text-gray-400">最新</span>
        </div>
      </div>

      {/* Input area */}
      <div className="p-3">
        <Textarea
          placeholder="Continue working on this task..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          className="min-h-[60px] resize-none border-0 bg-transparent p-0 focus-visible:ring-0 text-sm"
          disabled={isLoading}
        />

        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button className="inline-flex items-center justify-center whitespace-nowrap rounded-md border border-input bg-background px-3 text-xs font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground h-7" />
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
              className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              title="添加附件"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <button
              onClick={() => showToast("工具功能开发中")}
              className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              title="工具"
            >
              <Wrench className="h-4 w-4" />
            </button>
          </div>
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!message.trim() || isLoading}
            className="bg-violet-600 hover:bg-violet-700 h-8 px-4"
          >
            {isLoading ? "处理中..." : "发送"}
          </Button>
        </div>
      </div>
    </div>
  );
}

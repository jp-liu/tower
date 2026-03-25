"use client";

import { useState, useCallback } from "react";
import { Paperclip, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface TaskMessageInputProps {
  onSend: (message: string) => void;
  isLoading?: boolean;
  fileChanges?: { added: number; removed: number };
  agentName?: string;
}

export function TaskMessageInput({
  onSend,
  isLoading = false,
  fileChanges = { added: 0, removed: 0 },
  agentName = "Claude Code",
}: TaskMessageInputProps) {
  const [message, setMessage] = useState("");

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

  return (
    <div className="border-t bg-white">
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
            <Button variant="outline" size="sm" className="h-7 text-xs">
              Default
            </Button>
            <button className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
              <Paperclip className="h-4 w-4" />
            </button>
            <button className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
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

"use client";

import { useState, useCallback } from "react";
import { Send, FileText, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n";
import type { PromptOption } from "./types";

interface TaskMessageInputProps {
  onSend: (message: string) => void;
  isLoading?: boolean;
  agentName?: string;
  prompts?: PromptOption[];
  selectedPromptId?: string | null;
  onPromptChange?: (promptId: string | null) => void;
}

export function TaskMessageInput({
  onSend,
  isLoading = false,
  agentName = "Claude Code",
  prompts = [],
  selectedPromptId = null,
  onPromptChange,
}: TaskMessageInputProps) {
  const { t } = useI18n();
  const [message, setMessage] = useState("");

  const handleSend = useCallback(() => {
    if (!message.trim() || isLoading) return;

    let finalMessage = message.trim();
    if (selectedPromptId) {
      const selectedPrompt = prompts.find((p) => p.id === selectedPromptId);
      if (selectedPrompt) {
        finalMessage = `${selectedPrompt.content}\n\n${finalMessage}`;
      }
    }

    onSend(finalMessage);
    setMessage("");
  }, [message, isLoading, onSend, selectedPromptId, prompts]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const selectedPrompt = prompts.find((p) => p.id === selectedPromptId);

  return (
    <div className="border-t border-border bg-card/50">
      {/* Prompt selector bar */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" />
            }
          >
            <FileText className="h-4 w-4" />
            {selectedPrompt ? selectedPrompt.name : t("settings.prompts.empty")}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[200px]">
            <DropdownMenuItem onClick={() => onPromptChange?.(null)}>
              <span className="text-muted-foreground">{t("settings.prompts.empty")}</span>
            </DropdownMenuItem>
            {prompts.map((p) => (
              <DropdownMenuItem key={p.id} onClick={() => onPromptChange?.(p.id)}>
                <span className="flex items-center gap-2">
                  {p.isDefault && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />}
                  {p.name}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="font-medium">{agentName}</span>
        </div>
      </div>

      {/* Input area */}
      <div className="p-4">
        <textarea
          placeholder={t("taskDetail.inputPlaceholder")}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          className="w-full resize-none rounded-lg border border-border bg-background p-3 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
          disabled={isLoading}
        />

        <div className="mt-3 flex items-center justify-end">
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!message.trim() || isLoading}
            className="h-8 gap-2 px-4 text-sm"
          >
            <Send className="h-4 w-4" />
            {isLoading ? t("taskDetail.sending") : t("taskDetail.send")}
          </Button>
        </div>
      </div>
    </div>
  );
}

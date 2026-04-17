"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, SendHorizonal } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useAssistantChat } from "@/hooks/use-assistant-chat";
import { useI18n } from "@/lib/i18n";
import { AssistantChatBubble } from "./assistant-chat-bubble";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AssistantChatProps {}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
      <Bot className="size-8 text-muted-foreground/40" />
      <h3 className="text-sm font-semibold text-foreground">{t("assistant.emptyTitle")}</h3>
      <p className="text-xs text-muted-foreground">{t("assistant.emptyBody")}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AssistantChat(_props: AssistantChatProps) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  const { messages, isThinking, sendMessage } = useAssistantChat({
    enabled: true,
  });

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-scroll to bottom on new messages or content growth
  const lastContentLen = messages[messages.length - 1]?.content.length ?? 0;
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, lastContentLen]);

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text || isThinking) return;
    sendMessage(text);
    setInputValue("");
    // Return focus to input after send
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    // Shift+Enter inserts newline naturally — no handler needed
  };

  const isSendDisabled = !inputValue.trim() || isThinking;

  return (
    <div className="flex flex-col h-full">
      {/* Message list */}
      <ScrollArea className="flex-1">
        <div
          className="flex flex-col gap-3 p-4 min-h-full"
          role="log"
          aria-live="polite"
        >
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            messages.map((m) => <AssistantChatBubble key={m.id} message={m} />)
          )}
          {/* Sentinel for auto-scroll */}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="border-t border-border bg-popover p-4">
        <div className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("assistant.inputPlaceholder")}
            className="flex-1 min-h-[40px] max-h-[120px] resize-none text-sm"
            rows={1}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={handleSend}
            disabled={isSendDisabled}
            aria-label={t("assistant.sendLabel")}
          >
            <SendHorizonal className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

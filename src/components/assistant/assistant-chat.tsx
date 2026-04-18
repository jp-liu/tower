"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, SendHorizonal, Square } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { useAssistant } from "./assistant-provider";
import { AssistantChatBubble } from "./assistant-chat-bubble";

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
// Main component — uses chat state from AssistantProvider (persists across routes)
// ---------------------------------------------------------------------------

export function AssistantChat() {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  // Chat state lives in the provider — survives route changes
  const {
    chatMessages: messages,
    isChatThinking: isThinking,
    isLoadingHistory,
    sendChatMessage: sendMessage,
    cancelChat,
  } = useAssistant();

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-scroll on new messages or content growth
  const lastContentLen = messages[messages.length - 1]?.content.length ?? 0;
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, lastContentLen]);

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text || isThinking) return;
    sendMessage(text);
    setInputValue("");
    inputRef.current?.focus();
  };

  const handleCancel = () => {
    const restored = cancelChat();
    if (restored) {
      setInputValue(restored);
    }
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ignore Enter during IME composition (e.g. Chinese input)
    if (e.nativeEvent.isComposing) return;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape" && isThinking) {
      e.preventDefault();
      handleCancel();
    }
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
          {isLoadingHistory ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <EmptyState />
          ) : (
            messages.map((m) => <AssistantChatBubble key={m.id} message={m} />)
          )}
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
          {isThinking ? (
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0 border-destructive/50 text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground"
              onClick={handleCancel}
              aria-label={t("assistant.cancelLabel")}
            >
              <Square className="h-3 w-3 fill-current" />
            </Button>
          ) : (
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
          )}
        </div>
      </div>
    </div>
  );
}

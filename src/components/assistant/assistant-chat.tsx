"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, ClipboardList, FolderPlus, Loader2, Search, SendHorizonal, Square, TrendingUp } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { useAssistant } from "./assistant-provider";
import { AssistantChatBubble } from "./assistant-chat-bubble";
import { useImageUpload, type PendingImage } from "@/hooks/use-image-upload";
import { ImageThumbnailStrip } from "./image-thumbnail-strip";
import { ImagePreviewModal } from "./image-preview-modal";

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

  const { pendingImages, addImages, removeImage, clearAll, hasUploading } = useImageUpload();
  const [previewImage, setPreviewImage] = useState<PendingImage | null>(null);
  const [messagePreviewUrl, setMessagePreviewUrl] = useState<string | null>(null);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-scroll on new messages or content growth
  const lastContentLen = messages[messages.length - 1]?.content.length ?? 0;
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, lastContentLen]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles: File[] = [];
    const items = Array.from(e.clipboardData.items);
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      addImages(imageFiles);
    }
    // Do NOT call e.preventDefault() — text items still paste normally
  }, [addImages]);

  const handleSend = () => {
    const text = inputValue.trim();
    const doneFilenames = pendingImages
      .filter((i) => i.status === "done")
      .map((i) => i.filename!);

    if (!text && doneFilenames.length === 0) return;
    if (isThinking || hasUploading) return;

    sendMessage(text, { imageFilenames: doneFilenames });
    setInputValue("");
    clearAll();
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

  const hasDoneImages = pendingImages.some((i) => i.status === "done");
  const isSendDisabled =
    (!inputValue.trim() && !hasDoneImages)
    || isThinking
    || hasUploading;

  return (
    <div className="flex flex-col h-full">
      {/* Message list */}
      <ScrollArea className="flex-1 overflow-hidden">
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
            <div className="flex flex-col items-center justify-center h-full gap-4 px-6">
              <Bot className="size-8 text-muted-foreground/40" />
              <h3 className="text-sm font-semibold text-foreground">{t("assistant.emptyTitle")}</h3>
              <div className="grid grid-cols-1 gap-2 w-full max-w-[280px]">
                {[
                  { icon: FolderPlus, label: t("assistant.suggestion.createProject") },
                  { icon: ClipboardList, label: t("assistant.suggestion.createTask") },
                  { icon: Search, label: t("assistant.suggestion.checkProgress") },
                  { icon: TrendingUp, label: t("assistant.suggestion.dailySummary") },
                ].map(({ icon: Icon, label }) => (
                  <button
                    key={label}
                    className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground text-left"
                    onClick={() => { setInputValue(label); inputRef.current?.focus(); }}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <AssistantChatBubble
                key={m.id}
                message={m}
                onImagePreview={(url) => setMessagePreviewUrl(url)}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="border-t border-border bg-popover p-4">
        <ImageThumbnailStrip
          pendingImages={pendingImages}
          onRemove={removeImage}
          onPreview={(img) => setPreviewImage(img)}
        />
        <div className={`flex items-end gap-2 ${pendingImages.length > 0 ? "mt-2" : ""}`}>
          <Textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={t("assistant.inputPlaceholder")}
            className="flex-1 min-h-[72px] max-h-[120px] resize-none text-sm"
            rows={3}
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
              className="h-8 w-8 shrink-0 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={handleSend}
              disabled={isSendDisabled}
              aria-label={t("assistant.sendLabel")}
            >
              <SendHorizonal className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      <ImagePreviewModal
        imageUrl={previewImage?.blobUrl ?? null}
        open={previewImage !== null}
        onOpenChange={(open) => { if (!open) setPreviewImage(null); }}
      />
      <ImagePreviewModal
        imageUrl={messagePreviewUrl}
        open={messagePreviewUrl !== null}
        onOpenChange={(open) => { if (!open) setMessagePreviewUrl(null); }}
      />
    </div>
  );
}

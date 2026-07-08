"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  ClipboardList,
  FolderPlus,
  Loader2,
  Plus,
  Search,
  SendHorizonal,
  Square,
  TrendingUp,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { useAssistant } from "./assistant-provider";
import { AssistantBindingBar } from "./assistant-binding-bar";
import { AssistantChatBubble } from "./assistant-chat-bubble";
import {
  useAttachmentUpload,
  type PendingAttachment,
} from "@/hooks/use-attachment-upload";
import { ImageStrip, FileStrip } from "./attachment-strip";
import { ImageLightbox } from "@/components/assets/image-lightbox";
import { TextPreviewDialog } from "@/components/assets/text-preview-dialog";
import {
  ALLOWED_IMAGE_EXTS,
  ALLOWED_TEXT_EXTS,
  ATTACHMENT_ACCEPT_ATTR,
  MAX_ATTACHMENTS,
  classifyAttachmentExt,
} from "@/lib/attachment-utils";

// ---------------------------------------------------------------------------
// Main component — uses chat state from AssistantProvider (persists across routes)
// ---------------------------------------------------------------------------

export function AssistantChat() {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  const {
    chatMessages: messages,
    isChatThinking: isThinking,
    isLoadingHistory,
    sendChatMessage: sendMessage,
    cancelChat,
    inputFocusSignal,
  } = useAssistant();

  const {
    pendingAttachments,
    addAttachments,
    removeAttachment,
    clearAll,
    hasUploading,
  } = useAttachmentUpload();
  const [previewAttachment, setPreviewAttachment] =
    useState<PendingAttachment | null>(null);
  const [messagePreviewUrl, setMessagePreviewUrl] = useState<string | null>(null);
  const [textPreview, setTextPreview] = useState<{ url: string; filename: string } | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Re-focus on demand (Ctrl+' while the panel is already open). Skip the
  // initial 0 so this doesn't double up with the mount focus above.
  useEffect(() => {
    if (inputFocusSignal > 0) inputRef.current?.focus();
  }, [inputFocusSignal]);

  // Auto-grow the input with content (up to the max-h-[160px] cap). We size it
  // in JS instead of CSS `field-sizing: content` because Chrome flickers the
  // cursor (pointer ↔ I-beam) while hovering a field-sizing textarea — the
  // element re-lays-out on every pointer-move. See the `!field-sizing-fixed`
  // override on the Textarea below.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [inputValue]);

  // 切 session 会先清空 messages 再异步灌入历史，全程走 isLoadingHistory。
  // 加载期间及加载完首帧都直接定位（instant），只有同一 session 内新增消息
  // / 流式回复时才用平滑滚动。wasLoadingRef 让历史加载后的那一帧也 instant。
  // 路由切换会让面板整棵卸载重挂（LayoutInner 对详情/普通页返回不同树），
  // 重挂首帧必须 instant，否则会出现「换页触发滚动动画」的误伤。
  const wasLoadingRef = useRef(false);
  const didMountScrollRef = useRef(false);
  const lastContentLen = messages[messages.length - 1]?.content.length ?? 0;
  useEffect(() => {
    const isMountFrame = !didMountScrollRef.current;
    didMountScrollRef.current = true;
    const behavior =
      isMountFrame || isLoadingHistory || wasLoadingRef.current
        ? "instant"
        : "smooth";
    wasLoadingRef.current = isLoadingHistory;
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, [messages.length, lastContentLen, isLoadingHistory]);

  // ---- Handlers --------------------------------------------------------------

  const remainingSlots = MAX_ATTACHMENTS - pendingAttachments.length;
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const hasAllowedExt = useCallback((name: string): boolean => {
    const dotIdx = name.lastIndexOf(".");
    const ext = dotIdx >= 0 ? name.slice(dotIdx) : "";
    return classifyAttachmentExt(ext) !== null;
  }, []);

  const ingestFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0 || remainingSlots <= 0) return;
      const accepted = files
        .filter((f) => {
          const dotIdx = f.name.lastIndexOf(".");
          const ext = dotIdx >= 0 ? f.name.slice(dotIdx) : "";
          return classifyAttachmentExt(ext) !== null;
        })
        .slice(0, remainingSlots);
      if (accepted.length > 0) addAttachments(accepted);
    },
    [addAttachments, remainingSlots]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      // Only intercept clipboard entries that are FILE-kind (e.g. user copied
      // foo.md in Finder, then pasted into the textarea). String-kind entries —
      // i.e. plain text the user copied — keep flowing through native paste so
      // long pasted text just lands in the textarea like normal.
      const items = Array.from(e.clipboardData.items);
      const droppedFiles: File[] = [];
      for (const item of items) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (!file) continue;
        // Filter against the attachment whitelist; ingestFiles also re-checks.
        // Image clipboard entries usually have empty file.name (e.g. "image.png"
        // from screenshots) — accept by mime prefix in that case.
        const looksLikeImage = item.type.startsWith("image/");
        if (looksLikeImage || hasAllowedExt(file.name)) {
          droppedFiles.push(file);
        }
      }
      if (droppedFiles.length > 0) ingestFiles(droppedFiles);
    },
    [ingestFiles, hasAllowedExt]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      if (files.length > 0) ingestFiles(files);
      // Reset value so picking the same file again still triggers onChange
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [ingestFiles]
  );

  const openFilePicker = () => fileInputRef.current?.click();

  // Drag-and-drop handlers — react to whole-window drags so the user gets a
  // visual cue as soon as they enter the chat panel. We use a counter to handle
  // the dragenter/dragleave bubbling behaviour cleanly.
  const dragDepth = useRef(0);

  const handleDragEnter = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      dragDepth.current += 1;
      setIsDraggingOver(true);
    },
    []
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDraggingOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      dragDepth.current = 0;
      setIsDraggingOver(false);
      const dropped = Array.from(e.dataTransfer.files).filter((f) =>
        hasAllowedExt(f.name)
      );
      if (dropped.length > 0) ingestFiles(dropped);
    },
    [hasAllowedExt, ingestFiles]
  );

  const handleSend = () => {
    const text = inputValue.trim();
    const doneFilenames = pendingAttachments
      .filter((i) => i.status === "done")
      .map((i) => i.filename!);

    if (!text && doneFilenames.length === 0) return;
    if (isThinking || hasUploading) return;

    sendMessage(text, { attachmentFilenames: doneFilenames });
    setInputValue("");
    clearAll();
    inputRef.current?.focus();
  };

  const handleCancel = () => {
    const restored = cancelChat();
    if (restored) setInputValue(restored);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

  const hasDoneAttachments = pendingAttachments.some((i) => i.status === "done");
  const isSendDisabled =
    (!inputValue.trim() && !hasDoneAttachments) || isThinking || hasUploading;

  return (
    <div className="flex flex-col h-full">
      {/* Message list */}
      <ScrollArea className="flex-1 overflow-hidden">
        <div
          className={`flex flex-col gap-3 p-4 min-h-full ${
            isLoadingHistory || messages.length === 0 ? "justify-center" : ""
          }`}
          role="log"
          aria-live="polite"
        >
          {isLoadingHistory ? (
            <div className="flex flex-col items-center justify-center gap-2">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {t("assistant.loading")}
              </span>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center gap-4 px-6">
              <Bot className="size-8 text-muted-foreground/40" />
              <h3 className="text-sm font-semibold text-foreground">
                {t("assistant.emptyTitle")}
              </h3>
              <div className="grid grid-cols-1 gap-2 w-full max-w-[280px]">
                {[
                  { icon: FolderPlus, label: t("assistant.suggestion.createProject") },
                  { icon: ClipboardList, label: t("assistant.suggestion.createTask") },
                  { icon: Search, label: t("assistant.suggestion.checkProgress") },
                  { icon: TrendingUp, label: t("assistant.suggestion.dailySummary") },
                ].map(({ icon: Icon, label }) => (
                  <Button
                    key={label}
                    variant="outline"
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground text-left justify-start h-auto"
                    onClick={() => {
                      setInputValue(label);
                      inputRef.current?.focus();
                    }}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <AssistantChatBubble
                key={m.id}
                message={m}
                onImagePreview={(url) => setMessagePreviewUrl(url)}
                onFilePreview={(url, filename) => setTextPreview({ url, filename })}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Scope pickers — sit directly above the composer */}
      <AssistantBindingBar />

      {/* Composer — edge-to-edge input (no nested box); the binding bar above
          carries the single divider from the message list */}
      <div
        className={`relative bg-sidebar transition-colors ${
          pendingAttachments.length > 0 ? "border-t border-border/60" : ""
        } ${isDraggingOver ? "ring-3 ring-inset ring-primary/40" : ""}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
          {isDraggingOver && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-primary/10 text-xs font-medium text-primary">
              {t("assistant.dropToUpload")}
            </div>
          )}
          {/* Block 1: image attachments — hidden when none */}
          <ImageStrip
            pendingAttachments={pendingAttachments}
            onRemove={removeAttachment}
            onPreview={(att: PendingAttachment) => setPreviewAttachment(att)}
          />

          {/* Block 2: file attachments — hidden when none */}
          <FileStrip
            pendingAttachments={pendingAttachments}
            onRemove={removeAttachment}
            onPreview={(att: PendingAttachment) => {
              if (att.filename) {
                setTextPreview({
                  url: `/api/internal/cache/${att.filename}`,
                  filename: att.file.name,
                });
              }
            }}
          />

          {/* Block 3: textarea */}
          <Textarea
            ref={inputRef}
            data-assistant-input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={t("assistant.inputPlaceholder")}
            className="!field-sizing-fixed min-h-[72px] max-h-[160px] w-full resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:border-0 bg-transparent dark:bg-transparent px-4 pt-3 text-sm"
            rows={3}
          />

          {/* Block 4: action bar */}
          <div className="flex items-center justify-between px-3 pb-2 pt-1">
            <input
              ref={fileInputRef}
              type="file"
              accept={ATTACHMENT_ACCEPT_ATTR}
              multiple
              hidden
              onChange={handleFileChange}
            />
            <Tooltip>
              <TooltipTrigger
                onClick={openFilePicker}
                disabled={remainingSlots <= 0}
                aria-label={t("assistant.addAttachment")}
                className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:pointer-events-none transition-colors"
              >
                <Plus className="h-4 w-4" />
              </TooltipTrigger>
              <TooltipContent side="top" align="start" className="max-w-xs">
                {remainingSlots <= 0 ? (
                  <span className="text-xs">
                    {t("assistant.attachmentLimitReached")}
                  </span>
                ) : (
                  <div className="space-y-1 text-xs">
                    <div className="font-medium">
                      {t("assistant.addAttachment")}
                    </div>
                    <div className="opacity-80">
                      <span>{t("assistant.attachmentTypeImages")}: </span>
                      <span className="font-mono">
                        {ALLOWED_IMAGE_EXTS.map((e) => `.${e}`).join(" ")}
                      </span>
                    </div>
                    <div className="opacity-80">
                      <span>{t("assistant.attachmentTypeText")}: </span>
                      <span className="font-mono">
                        {ALLOWED_TEXT_EXTS.map((e) => `.${e}`).join(" ")}
                      </span>
                    </div>
                  </div>
                )}
              </TooltipContent>
            </Tooltip>

            {isThinking ? (
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7 border-destructive/50 text-destructive transition-colors hover:bg-destructive/20 hover:text-destructive hover:border-destructive"
                onClick={handleCancel}
                aria-label={t("assistant.cancelLabel")}
              >
                <Square className="h-3 w-3 fill-current" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                onClick={handleSend}
                disabled={isSendDisabled}
                aria-label={t("assistant.sendLabel")}
              >
                <SendHorizonal className="h-4 w-4" />
              </Button>
            )}
          </div>
      </div>

      <ImageLightbox
        imageUrl={previewAttachment?.blobUrl ?? null}
        filename={previewAttachment?.filename ?? ""}
        open={previewAttachment !== null && previewAttachment.kind === "image"}
        onOpenChange={(open) => {
          if (!open) setPreviewAttachment(null);
        }}
      />
      <ImageLightbox
        imageUrl={messagePreviewUrl}
        filename={messagePreviewUrl?.split("/").pop()?.split("?")[0] ?? ""}
        open={messagePreviewUrl !== null}
        onOpenChange={(open) => {
          if (!open) setMessagePreviewUrl(null);
        }}
      />
      <TextPreviewDialog
        url={textPreview?.url ?? null}
        filename={textPreview?.filename ?? ""}
        open={textPreview !== null}
        onOpenChange={(open) => {
          if (!open) setTextPreview(null);
        }}
      />
    </div>
  );
}

"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, Check, ChevronRight, Copy, ImageOff, User } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { ChatMessage } from "@/hooks/use-assistant-chat";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AssistantChatBubbleProps {
  message: ChatMessage;
  onImagePreview?: (url: string) => void;
}

// ---------------------------------------------------------------------------
// CopyButton — hover-visible copy action
// ---------------------------------------------------------------------------

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Silent fail
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${className ?? ""}`}
      aria-label={t("assistant.copy")}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// MessageImage sub-component
// ---------------------------------------------------------------------------

function MessageImage({
  filename,
  onPreview,
}: {
  filename: string;
  onPreview?: (url: string) => void;
}) {
  const { t } = useI18n();
  const [broken, setBroken] = useState(false);
  const url = `/api/internal/cache/${filename}`;

  if (broken) {
    return (
      <div
        className="size-16 rounded-md bg-muted flex items-center justify-center"
        title={t("assistant.brokenImage")}
      >
        <ImageOff className="size-4 text-muted-foreground" />
      </div>
    );
  }

  return (
    <button
      type="button"
      className="relative size-16 rounded-md overflow-hidden bg-muted shrink-0"
      onClick={() => onPreview?.(url)}
    >
      <img
        src={url}
        alt=""
        loading="lazy"
        className="size-16 rounded-md object-cover cursor-pointer hover:opacity-80 transition-opacity"
        onError={() => setBroken(true)}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// User bubble
// ---------------------------------------------------------------------------

function UserBubble({
  content,
  imageFilenames,
  onImagePreview,
}: {
  content: string;
  imageFilenames?: string[];
  onImagePreview?: (url: string) => void;
}) {
  return (
    <div
      className="flex justify-end gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200"
      aria-label="You"
    >
      <div className="bg-primary text-primary-foreground max-w-[80%] rounded-2xl rounded-br-sm px-3 py-2 text-sm whitespace-pre-wrap break-words">
        {imageFilenames && imageFilenames.length > 0 && (
          <div
            className="flex flex-wrap gap-1.5 mb-2"
            style={{ maxWidth: "calc(4 * 64px + 3 * 6px)" }}
          >
            {imageFilenames.map((filename) => (
              <MessageImage
                key={filename}
                filename={filename}
                onPreview={onImagePreview}
              />
            ))}
          </div>
        )}
        {content}
      </div>
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted mt-1">
        <User className="size-3.5 text-muted-foreground" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assistant bubble
// ---------------------------------------------------------------------------

function AssistantBubble({ content }: { content: string }) {
  return (
    <div
      className="group/bubble flex justify-start gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200"
      aria-label="Assistant"
    >
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-1">
        <Bot className="size-3.5 text-primary" />
      </div>
      <div className="max-w-[85%]">
        <div className="bg-muted text-foreground rounded-2xl rounded-bl-sm px-3 py-2">
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                code({ inline, className, children, ...props }: any) {
                  if (inline) {
                    return (
                      <code
                        className="bg-muted/80 px-1 rounded text-[13px] font-mono"
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  }
                  return (
                    <code
                      className="bg-muted rounded-md p-3 font-mono text-[13px] overflow-x-auto block"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                },
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        </div>
        {/* Action bar — visible on hover */}
        <div className="flex items-center gap-0.5 mt-0.5 opacity-0 group-hover/bubble:opacity-100 transition-opacity">
          <CopyButton text={content} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thinking bubble
// ---------------------------------------------------------------------------

function ThinkingBubble() {
  const { t } = useI18n();
  return (
    <div
      className="flex justify-start gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200"
      role="status"
      aria-live="polite"
      aria-label={t("assistant.thinking")}
    >
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-1">
        <Bot className="size-3.5 text-primary" />
      </div>
      <div className="bg-muted/50 text-muted-foreground max-w-[200px] rounded-2xl rounded-bl-sm px-3 py-2">
        <div className="flex items-center gap-1">
          <span
            className="size-1.5 rounded-full bg-primary/60 animate-pulse"
            style={{ animationDelay: "0ms" }}
          />
          <span
            className="size-1.5 rounded-full bg-primary/60 animate-pulse"
            style={{ animationDelay: "150ms" }}
          />
          <span
            className="size-1.5 rounded-full bg-primary/60 animate-pulse"
            style={{ animationDelay: "300ms" }}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool-call bubble
// ---------------------------------------------------------------------------

function ToolBubble({ content, toolName }: { content: string; toolName?: string }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useI18n();
  const displayName = toolName ?? t("assistant.toolLabel");

  return (
    <div className="group/tool flex justify-start gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
      {/* Spacer to align with assistant avatar */}
      <div className="size-7 shrink-0" />
      <div className="bg-muted/60 border border-border max-w-[90%] rounded-lg px-3 py-1">
        {/* Header */}
        <button
          className="flex items-center gap-1.5 w-full text-left py-0.5"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={t("assistant.expandTool")}
        >
          <ChevronRight
            className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-150 ${
              expanded ? "rotate-90" : ""
            }`}
          />
          <span className="text-xs font-semibold text-foreground truncate">{displayName}</span>
          <span className="flex-1" />
          <CopyButton text={content} className="opacity-0 group-hover/tool:opacity-100" />
          <span className="bg-muted text-muted-foreground text-[10px] px-1.5 rounded shrink-0">
            {t("assistant.toolLabel")}
          </span>
        </button>

        {/* Expanded body */}
        {expanded && (
          <div className="mt-1 border-t border-border pt-1">
            <pre className="font-mono text-[12px] max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all text-muted-foreground">
              {content}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function AssistantChatBubble({ message, onImagePreview }: AssistantChatBubbleProps) {
  switch (message.role) {
    case "user":
      return (
        <UserBubble
          content={message.content}
          imageFilenames={message.imageFilenames}
          onImagePreview={onImagePreview}
        />
      );
    case "assistant":
      return <AssistantBubble content={message.content} />;
    case "thinking":
      return <ThinkingBubble />;
    case "tool":
      return <ToolBubble content={message.content} toolName={message.toolName} />;
    default:
      return null;
  }
}

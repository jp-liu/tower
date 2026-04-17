"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronRight } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { ChatMessage } from "@/hooks/use-assistant-chat";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AssistantChatBubbleProps {
  message: ChatMessage;
}

// ---------------------------------------------------------------------------
// User bubble
// ---------------------------------------------------------------------------

function UserBubble({ content }: { content: string }) {
  return (
    <div
      className="flex justify-end animate-in fade-in slide-in-from-bottom-2 duration-200"
      aria-label={`You: ${content.slice(0, 60)}`}
    >
      <div className="bg-primary text-primary-foreground max-w-[80%] rounded-2xl rounded-br-sm px-3 py-2 text-sm whitespace-pre-wrap break-words">
        {content}
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
      className="flex justify-start animate-in fade-in slide-in-from-bottom-2 duration-200"
      aria-label={`Assistant: ${content.slice(0, 60)}`}
    >
      <div className="bg-muted text-foreground max-w-[85%] rounded-2xl rounded-bl-sm px-3 py-2">
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
      className="flex justify-start animate-in fade-in slide-in-from-bottom-2 duration-200"
      role="status"
      aria-live="polite"
      aria-label={t("assistant.thinking")}
    >
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
    <div className="flex justify-start animate-in fade-in slide-in-from-bottom-2 duration-200">
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
          <span className="ml-auto bg-muted text-muted-foreground text-[10px] px-1.5 rounded shrink-0">
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

export function AssistantChatBubble({ message }: AssistantChatBubbleProps) {
  switch (message.role) {
    case "user":
      return <UserBubble content={message.content} />;
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

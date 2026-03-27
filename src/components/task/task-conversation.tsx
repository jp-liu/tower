"use client";

import { useEffect, useRef } from "react";
import { Info, User, Bot } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: Date;
}

interface TaskConversationProps {
  messages: Message[];
}

export function TaskConversation({ messages }: TaskConversationProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 ring-1 ring-amber-500/20">
            <Bot className="h-7 w-7 text-amber-400/60" />
          </div>
          <p className="text-sm text-muted-foreground">{t("taskDetail.emptyState")}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{t("taskDetail.emptyHint")}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === "system") {
    return (
      <div className="flex items-start gap-2 text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
        <p className="text-xs break-words overflow-hidden">{message.content}</p>
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="flex items-start gap-3">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/25">
          <User className="h-3.5 w-3.5 text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0 rounded-lg bg-accent p-3">
          <p className="text-sm text-foreground whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    );
  }

  // assistant — render markdown
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-amber-500/15 ring-1 ring-amber-500/25">
        <Bot className="h-3.5 w-3.5 text-amber-400" />
      </div>
      <div className="flex-1 min-w-0 rounded-lg border border-border bg-card p-3">
        <div className="prose prose-sm dark:prose-invert max-w-none break-words
          prose-p:my-1 prose-p:leading-relaxed
          prose-headings:my-2 prose-headings:font-semibold
          prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5
          prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
          prose-pre:my-2 prose-pre:rounded-lg prose-pre:bg-muted prose-pre:p-3
          prose-a:text-blue-500 prose-a:no-underline hover:prose-a:underline
          prose-blockquote:border-border prose-blockquote:text-muted-foreground
          prose-table:text-sm prose-th:text-left
        ">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

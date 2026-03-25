"use client";

import { useEffect, useRef } from "react";
import { Info, User, Bot } from "lucide-react";

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
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-gray-400">
        <div className="text-center">
          <Bot className="mx-auto h-12 w-12 mb-3 opacity-50" />
          <p className="text-sm">开始对话，让 AI 代理执行任务</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-auto p-4 space-y-4">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === "system") {
    return (
      <div className="flex items-start gap-2 text-gray-500">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <p className="text-sm">{message.content}</p>
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="flex items-start gap-3">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-green-100">
          <User className="h-4 w-4 text-green-600" />
        </div>
        <div className="flex-1 rounded-lg bg-gray-50 p-3">
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  // assistant
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-purple-100">
        <Bot className="h-4 w-4 text-purple-600" />
      </div>
      <div className="flex-1 rounded-lg border p-3">
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
  );
}

"use client";

import { useState, useCallback, useEffect } from "react";
import { TaskMetadata } from "./task-metadata";
import { TaskConversation, type Message } from "./task-conversation";
import { TaskMessageInput } from "./task-message-input";
import { getTaskMessages } from "@/actions/agent-actions";
import type { Task } from "@prisma/client";

interface TaskDetailPanelProps {
  task: Task;
  onClose: () => void;
  onSendMessage: (taskId: string, message: string) => Promise<unknown>;
}

export function TaskDetailPanel({
  task,
  onClose,
  onSendMessage,
}: TaskDetailPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Load messages from server on mount and when task changes
  useEffect(() => {
    let cancelled = false;
    getTaskMessages(task.id).then((serverMessages) => {
      if (cancelled) return;
      setMessages(
        serverMessages.map((m) => ({
          id: m.id,
          role: m.role.toLowerCase() as "user" | "assistant" | "system",
          content: m.content,
          createdAt: new Date(m.createdAt),
        }))
      );
    });
    return () => { cancelled = true; };
  }, [task.id]);

  const handleSend = useCallback(
    async (content: string) => {
      // Optimistic: add user message immediately
      const userMsg: Message = {
        id: `msg-${Date.now()}`,
        role: "user",
        content,
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);

      try {
        const result = await onSendMessage(task.id, content) as {
          userMessage: { id: string };
          assistantMessage: { id: string; content: string; createdAt: Date };
        } | undefined;

        if (result?.assistantMessage) {
          setMessages((prev) => [
            ...prev,
            {
              id: result.assistantMessage.id,
              role: "assistant" as const,
              content: result.assistantMessage.content,
              createdAt: new Date(result.assistantMessage.createdAt),
            },
          ]);
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "system" as const,
            content: "发送失败，请重试",
            createdAt: new Date(),
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [task.id, onSendMessage]
  );

  return (
    <div
      className="flex h-full w-[520px] flex-shrink-0 flex-col border-l bg-white"
      data-testid="task-detail-panel"
    >
      <TaskMetadata
        title={task.title}
        description="聚焦当前任务的执行对话。分支状态和连续 follow-up 输入。"
        branch={`vk/${task.id.slice(0, 4)}-`}
        hasConversation={messages.length > 0}
        updatedAt={task.updatedAt}
        onBack={onClose}
      />
      <TaskConversation messages={messages} />
      <TaskMessageInput
        onSend={handleSend}
        isLoading={isLoading}
      />
    </div>
  );
}

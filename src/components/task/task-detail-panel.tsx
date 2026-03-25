"use client";

import { useState, useCallback, useEffect } from "react";
import { TaskMetadata } from "./task-metadata";
import { TaskConversation, type Message } from "./task-conversation";
import { TaskMessageInput } from "./task-message-input";
import type { Task } from "@prisma/client";

interface TaskDetailPanelProps {
  task: Task;
  onClose: () => void;
  onSendMessage: (taskId: string, message: string) => Promise<void>;
  initialMessages?: Message[];
}

export function TaskDetailPanel({
  task,
  onClose,
  onSendMessage,
  initialMessages = [],
}: TaskDetailPanelProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [isLoading, setIsLoading] = useState(false);
  const [fileChanges] = useState({ added: 0, removed: 0 });

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  const handleSend = useCallback(
    async (content: string) => {
      const userMessage: Message = {
        id: `msg-${Date.now()}`,
        role: "user",
        content,
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      try {
        await onSendMessage(task.id, content);

        // Mock assistant response for now
        const assistantMessage: Message = {
          id: `msg-${Date.now()}-resp`,
          role: "assistant",
          content: `收到你的消息。正在处理任务「${task.title}」...\n\n我会分析代码并给出建议。`,
          createdAt: new Date(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } catch {
        const errorMessage: Message = {
          id: `msg-${Date.now()}-err`,
          role: "system",
          content: "发送失败，请重试",
          createdAt: new Date(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsLoading(false);
      }
    },
    [task.id, task.title, onSendMessage]
  );

  return (
    <div
      className="flex h-full w-[520px] flex-shrink-0 flex-col border-l bg-white animate-in slide-in-from-right duration-200"
      data-testid="task-detail-panel"
    >
      {/* Metadata */}
      <TaskMetadata
        title={task.title}
        description="聚焦当前任务的执行对话。分支状态和连续 follow-up 输入。"
        branch={`vk/${task.id.slice(0, 4)}-`}
        hasConversation={messages.length > 0}
        updatedAt={task.updatedAt}
        onBack={onClose}
      />

      {/* Conversation */}
      <TaskConversation messages={messages} />

      {/* Input */}
      <TaskMessageInput
        onSend={handleSend}
        isLoading={isLoading}
        fileChanges={fileChanges}
      />
    </div>
  );
}

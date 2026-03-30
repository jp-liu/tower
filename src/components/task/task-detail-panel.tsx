"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { TaskMetadata } from "./task-metadata";
import { TaskConversation, type Message } from "./task-conversation";
import { TaskMessageInput } from "./task-message-input";
import { getTaskMessages, sendTaskMessage } from "@/actions/agent-actions";
import { getPrompts } from "@/actions/prompt-actions";
import { getConfigValue } from "@/actions/config-actions";
import { interpolateBranchTemplate } from "@/lib/branch-template";
import type { Task } from "@prisma/client";
import type { PromptOption } from "./types";
import { useI18n } from "@/lib/i18n";

interface TaskDetailPanelProps {
  task: Task;
  onClose: () => void;
}

export function TaskDetailPanel({
  task,
  onClose,
}: TaskDetailPanelProps) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [prompts, setPrompts] = useState<PromptOption[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [branchTemplate, setBranchTemplate] = useState("vk/{taskIdShort}-");
  const abortRef = useRef<AbortController | null>(null);

  // Load existing messages
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

  // Load prompts
  useEffect(() => {
    let cancelled = false;
    getPrompts().then((data) => {
      if (cancelled) return;
      const mapped: PromptOption[] = data.map((p) => ({
        id: p.id,
        name: p.name,
        content: p.content,
        isDefault: p.isDefault,
      }));
      setPrompts(mapped);
      const defaultPrompt = mapped.find((p) => p.isDefault);
      if (defaultPrompt) {
        setSelectedPromptId(defaultPrompt.id);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Load branch template from config
  useEffect(() => {
    getConfigValue<string>("git.branchTemplate", "vk/{taskIdShort}-").then(setBranchTemplate);
  }, []);

  // Cleanup abort on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const handleSend = useCallback(
    async (content: string) => {
      // Show user message immediately
      const userMsg: Message = {
        id: `msg-${Date.now()}`,
        role: "user",
        content,
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);

      try {
        // Save user message to DB
        await sendTaskMessage(task.id, content);

        // Create a streaming assistant message placeholder
        const assistantMsgId = `assistant-${Date.now()}`;
        const assistantMsg: Message = {
          id: assistantMsgId,
          role: "assistant",
          content: "",
          createdAt: new Date(),
        };
        setMessages((prev) => [...prev, assistantMsg]);

        // Call the SSE stream endpoint
        const abortController = new AbortController();
        abortRef.current = abortController;

        const res = await fetch(`/api/tasks/${task.id}/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: content }),
          signal: abortController.signal,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: "Execution failed" }));
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, role: "system" as const, content: errData.error || t("taskDetail.executionFailed") }
                : m
            )
          );
          return;
        }

        // Read SSE stream
        const reader = res.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === "log" || event.type === "result") {
                // Append text content to the assistant message
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: m.content + event.content }
                      : m
                  )
                );
              } else if (event.type === "tool") {
                // Append tool usage info on its own line
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: m.content + (m.content ? "\n" : "") + event.content }
                      : m
                  )
                );
              } else if (event.type === "error") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: m.content || event.content }
                      : m
                  )
                );
              }
            } catch {
              // Skip malformed JSON lines
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "system" as const,
            content: t("taskDetail.executionFailedRetry"),
            createdAt: new Date(),
          },
        ]);
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [task.id]
  );

  return (
    <div
      className="flex h-full w-[600px] flex-shrink-0 flex-col border-l border-border bg-sidebar"
      data-testid="task-detail-panel"
    >
      <TaskMetadata
        title={task.title}
        description={t("taskDetail.panelDescription")}
        branch={interpolateBranchTemplate(branchTemplate, task.id)}
        hasConversation={messages.length > 0}
        updatedAt={task.updatedAt}
        onBack={onClose}
      />
      <TaskConversation messages={messages} />
      <TaskMessageInput
        onSend={handleSend}
        isLoading={isLoading}
        prompts={prompts}
        selectedPromptId={selectedPromptId}
        onPromptChange={setSelectedPromptId}
      />
    </div>
  );
}

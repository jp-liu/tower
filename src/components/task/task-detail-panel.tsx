"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { TaskMetadata } from "./task-metadata";
import { TaskConversation, type Message } from "./task-conversation";
import { TaskMessageInput } from "./task-message-input";
import { TaskDiffView } from "./task-diff-view";
import { getTaskMessages, sendTaskMessage } from "@/actions/agent-actions";
import { getPrompts } from "@/actions/prompt-actions";
import type { Task } from "@prisma/client";
import type { PromptOption } from "./types";
import { useI18n } from "@/lib/i18n";

interface TaskDetailPanelProps {
  task: Task;
  workspaceId: string;
  onClose: () => void;
}

export function TaskDetailPanel({
  task,
  workspaceId,
  onClose,
}: TaskDetailPanelProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [prompts, setPrompts] = useState<PromptOption[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"conversation" | "changes">("conversation");
  const [diffData, setDiffData] = useState<any>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [taskStatus, setTaskStatus] = useState(task.status);
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

  // Fetch diff when Changes tab is active and task is IN_REVIEW
  useEffect(() => {
    if (activeTab !== "changes" || taskStatus !== "IN_REVIEW") return;
    let cancelled = false;
    setIsLoadingDiff(true);
    fetch(`/api/tasks/${task.id}/diff`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (!cancelled) setDiffData(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setIsLoadingDiff(false); });
    return () => { cancelled = true; };
  }, [activeTab, taskStatus, task.id]);

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
              } else if (event.type === "status_changed") {
                setTaskStatus(event.status);
                router.refresh();
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
    [task.id, router, t]
  );

  return (
    <div
      className="flex h-full w-[600px] flex-shrink-0 flex-col border-l border-border bg-sidebar"
      data-testid="task-detail-panel"
    >
      <TaskMetadata
        title={task.title}
        description={t("taskDetail.panelDescription")}
        branch={`task/${task.id}`}
        hasConversation={messages.length > 0}
        updatedAt={task.updatedAt}
        onBack={onClose}
      />

      {/* Tab bar + View Details button */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab("conversation")}
            className={`px-3 py-1 text-xs font-medium rounded-md ${activeTab === "conversation" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t("taskPage.conversation")}
          </button>
          <button
            onClick={() => setActiveTab("changes")}
            className={`px-3 py-1 text-xs font-medium rounded-md ${activeTab === "changes" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t("taskPage.changes")}
          </button>
        </div>
        <button
          onClick={() => router.push(`/workspaces/${workspaceId}/tasks/${task.id}`)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3 w-3" />
          {t("taskPage.viewDetails")}
        </button>
      </div>

      {/* Content area */}
      {activeTab === "conversation" ? (
        <>
          <TaskConversation messages={messages} />
          <TaskMessageInput
            onSend={handleSend}
            isLoading={isLoading}
            prompts={prompts}
            selectedPromptId={selectedPromptId}
            onPromptChange={setSelectedPromptId}
          />
        </>
      ) : (
        <div className="flex-1 overflow-hidden">
          {isLoadingDiff ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">{t("taskPage.loadingDiff")}</p>
            </div>
          ) : diffData ? (
            <TaskDiffView
              files={diffData.files}
              totalAdded={diffData.totalAdded}
              totalRemoved={diffData.totalRemoved}
              hasConflicts={diffData.hasConflicts}
              conflictFiles={diffData.conflictFiles}
              commitCount={diffData.commitCount}
              taskId={task.id}
              taskTitle={task.title}
              taskStatus={taskStatus}
              baseBranch={(task as any).baseBranch ?? "main"}
              onMergeComplete={() => router.refresh()}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">{t("taskPage.noChanges")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

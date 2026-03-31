"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, GitBranch, Loader2 } from "lucide-react";
import Link from "next/link";
import { TaskConversation, type Message } from "@/components/task/task-conversation";
import { TaskMessageInput } from "@/components/task/task-message-input";
import { TaskDiffView } from "@/components/task/task-diff-view";
import { Badge } from "@/components/ui/badge";
import { getTaskMessages } from "@/actions/agent-actions";
import { getPrompts } from "@/actions/prompt-actions";
import type { PromptOption } from "@/components/task/types";
import type { DiffResponse } from "@/lib/diff-parser";

interface TaskPageClientProps {
  task: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    baseBranch: string | null;
    projectId: string;
    createdAt: string;
    updatedAt: string;
    project: { id: string; name: string; type: string; localPath: string | null } | null;
  };
  workspaceId: string;
}

type DiffData = DiffResponse & { commitCount: number };

const STATUS_LABELS: Record<string, string> = {
  TODO: "待处理",
  IN_PROGRESS: "执行中",
  IN_REVIEW: "待评审",
  DONE: "已完成",
  CANCELLED: "已取消",
};

const STATUS_COLORS: Record<string, string> = {
  TODO: "bg-muted text-muted-foreground",
  IN_PROGRESS: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
  IN_REVIEW: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
  DONE: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
  CANCELLED: "bg-muted text-muted-foreground",
};

export function TaskPageClient({ task, workspaceId }: TaskPageClientProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [prompts, setPrompts] = useState<PromptOption[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState(task.status);
  const [diffData, setDiffData] = useState<DiffData | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Load existing messages on mount
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

  // Load prompts on mount
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

  // Cleanup abort on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // Auto-fetch diff when task is IN_REVIEW
  useEffect(() => {
    if (taskStatus !== "IN_REVIEW") return;
    let cancelled = false;
    setIsLoadingDiff(true);
    fetch(`/api/tasks/${task.id}/diff`)
      .then((res) => res.json())
      .then((data: DiffData) => {
        if (cancelled) return;
        setDiffData(data);
      })
      .catch(() => {
        if (cancelled) return;
        setDiffData(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingDiff(false);
      });
    return () => { cancelled = true; };
  }, [task.id, taskStatus]);

  const handleSend = useCallback(
    async (content: string) => {
      const userMsg: Message = {
        id: `msg-${Date.now()}`,
        role: "user",
        content,
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);

      try {
        const { sendTaskMessage } = await import("@/actions/agent-actions");
        await sendTaskMessage(task.id, content);

        const assistantMsgId = `assistant-${Date.now()}`;
        const assistantMsg: Message = {
          id: assistantMsgId,
          role: "assistant",
          content: "",
          createdAt: new Date(),
        };
        setMessages((prev) => [...prev, assistantMsg]);

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
                ? { ...m, role: "system" as const, content: errData.error || "执行失败" }
                : m
            )
          );
          return;
        }

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
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: m.content + event.content }
                      : m
                  )
                );
              } else if (event.type === "tool") {
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
            content: "执行失败，请重试",
            createdAt: new Date(),
          },
        ]);
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [task.id, router]
  );

  const handleMergeComplete = useCallback(() => {
    setTaskStatus("DONE");
    router.refresh();
  }, [router]);

  return (
    <div className="flex h-screen bg-background">
      {/* Left panel: Chat (40%) */}
      <div className="flex w-[40%] min-w-0 flex-col border-r border-border bg-sidebar">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Link
            href={`/workspaces/${workspaceId}`}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="truncate text-sm font-semibold text-foreground">{task.title}</h1>
            <div className="mt-1 flex items-center gap-2">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[taskStatus] ?? "bg-muted text-muted-foreground"}`}>
                {STATUS_LABELS[taskStatus] ?? taskStatus}
              </span>
              {task.baseBranch && (
                <Badge variant="secondary" className="bg-muted text-muted-foreground text-[10px] font-mono border border-border gap-1">
                  <GitBranch className="h-2.5 w-2.5" />
                  {task.baseBranch}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Conversation */}
        <TaskConversation messages={messages} />

        {/* Message input */}
        <TaskMessageInput
          onSend={handleSend}
          isLoading={isLoading}
          prompts={prompts}
          selectedPromptId={selectedPromptId}
          onPromptChange={setSelectedPromptId}
        />
      </div>

      {/* Right panel: Tabs (60%) */}
      <div className="flex w-[60%] min-w-0 flex-col">
        {/* Tab bar */}
        <div className="flex items-center border-b border-border px-4" role="tablist">
          <button
            role="tab"
            aria-selected
            className="border-b-2 border-primary px-4 py-3 text-sm font-medium text-foreground"
          >
            Changes
          </button>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-auto">
          {isLoadingDiff ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
              baseBranch={task.baseBranch ?? "main"}
              onMergeComplete={handleMergeComplete}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">
                {taskStatus === "IN_REVIEW"
                  ? "加载变更中..."
                  : "Start an execution to see changes"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

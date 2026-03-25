"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { Task, Priority, TaskStatus } from "@prisma/client";

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    title: string;
    description: string;
    priority: Priority;
    status: TaskStatus;
  }) => void;
  onUpdate?: (taskId: string, data: {
    title: string;
    description: string;
    priority: Priority;
  }) => void;
  defaultStatus?: TaskStatus;
  editTask?: Task | null;
}

export function CreateTaskDialog({
  open,
  onOpenChange,
  onSubmit,
  onUpdate,
  defaultStatus = "TODO",
  editTask,
}: CreateTaskDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");

  const isEditing = !!editTask;

  // Pre-fill when editing
  useEffect(() => {
    if (editTask) {
      setTitle(editTask.title);
      setDescription(editTask.description ?? "");
      setPriority(editTask.priority);
    } else {
      setTitle("");
      setDescription("");
      setPriority("MEDIUM");
    }
  }, [editTask]);

  // Reset when dialog closes
  useEffect(() => {
    if (!open && !editTask) {
      setTitle("");
      setDescription("");
      setPriority("MEDIUM");
    }
  }, [open, editTask]);

  const handleSubmit = () => {
    if (!title.trim()) return;
    if (isEditing && onUpdate) {
      onUpdate(editTask.id, { title, description, priority });
    } else {
      onSubmit({ title, description, priority, status: defaultStatus });
    }
    setTitle("");
    setDescription("");
    setPriority("MEDIUM");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? "编辑任务" : "新建任务"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="title">任务标题</Label>
            <Input
              id="title"
              data-testid="task-title"
              placeholder="输入任务标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">描述</Label>
            <Textarea
              id="description"
              placeholder="输入任务描述 (支持 Markdown)"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {/* Priority - Button Group instead of Select */}
          <div className="space-y-2">
            <Label>优先级</Label>
            <div className="flex gap-1.5">
              {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).map((p) => {
                const config = {
                  LOW: { label: "低", style: "text-slate-300 border-slate-500/30 bg-slate-500/10" },
                  MEDIUM: { label: "中", style: "text-amber-300 border-amber-500/30 bg-amber-500/10" },
                  HIGH: { label: "高", style: "text-orange-300 border-orange-500/30 bg-orange-500/10" },
                  CRITICAL: { label: "紧急", style: "text-rose-300 border-rose-500/30 bg-rose-500/10" },
                }[p];
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                      priority === p
                        ? `${config.style} ring-1 ring-current/20`
                        : "border-border text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {config.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            className="bg-violet-600 hover:bg-violet-700"
          >
            {isEditing ? "保存" : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { getProjectBranches } from "@/actions/git-actions";
import type { Task, Priority, TaskStatus } from "@prisma/client";

interface LabelOption {
  id: string;
  name: string;
  color: string;
  isBuiltin: boolean;
}

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    title: string;
    description: string;
    priority: Priority;
    status: TaskStatus;
    labelIds: string[];
    baseBranch?: string;
  }) => void;
  onUpdate?: (taskId: string, data: {
    title: string;
    description: string;
    priority: Priority;
    labelIds: string[];
  }) => void;
  defaultStatus?: TaskStatus;
  editTask?: Task | null;
  editTaskLabelIds?: string[];
  labels: LabelOption[];
  projectType?: string;
  projectLocalPath?: string | null;
}

export function CreateTaskDialog({
  open,
  onOpenChange,
  onSubmit,
  onUpdate,
  defaultStatus = "TODO",
  editTask,
  editTaskLabelIds,
  labels,
  projectType,
  projectLocalPath,
}: CreateTaskDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const { t } = useI18n();

  const isEditing = !!editTask;
  const isGitProject = projectType === "GIT" && !!projectLocalPath;

  // Pre-fill when editing
  useEffect(() => {
    if (editTask) {
      setTitle(editTask.title);
      setDescription(editTask.description ?? "");
      setPriority(editTask.priority);
      setSelectedLabelIds(editTaskLabelIds ?? []);
    } else {
      setTitle("");
      setDescription("");
      setPriority("MEDIUM");
      setSelectedLabelIds([]);
    }
  }, [editTask, editTaskLabelIds]);

  // Reset when dialog closes
  useEffect(() => {
    if (!open && !editTask) {
      setTitle("");
      setDescription("");
      setPriority("MEDIUM");
      setSelectedLabelIds([]);
      setBranches([]);
      setSelectedBranch("");
    }
  }, [open, editTask]);

  // Fetch branches when dialog opens for a GIT project in create mode
  useEffect(() => {
    if (!open || !isGitProject || editTask) return;
    setBranchesLoading(true);
    getProjectBranches(projectLocalPath!).then((list) => {
      setBranches(list);
      setSelectedBranch(list[0] ?? "");
      setBranchesLoading(false);
    }).catch(() => {
      setBranches([]);
      setSelectedBranch("");
      setBranchesLoading(false);
    });
  }, [open, isGitProject, projectLocalPath, editTask]);

  const handleSubmit = () => {
    if (!title.trim()) return;
    if (isEditing && onUpdate) {
      onUpdate(editTask.id, { title, description, priority, labelIds: selectedLabelIds });
    } else {
      onSubmit({
        title,
        description,
        priority,
        status: defaultStatus,
        labelIds: selectedLabelIds,
        ...(isGitProject && selectedBranch ? { baseBranch: selectedBranch } : {}),
      });
    }
    setTitle("");
    setDescription("");
    setPriority("MEDIUM");
    setSelectedLabelIds([]);
    setBranches([]);
    setSelectedBranch("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? t("task.edit") : t("task.create")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="title">{t("task.title")}</Label>
            <Input
              id="title"
              data-testid="task-title"
              placeholder={t("task.titlePlaceholder")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">{t("task.description")}</Label>
            <Textarea
              id="description"
              placeholder={t("task.descPlaceholder")}
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {/* Priority - Button Group instead of Select */}
          <div className="space-y-2">
            <Label>{t("task.priority")}</Label>
            <div className="flex gap-1.5">
              {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).map((p) => {
                const config = {
                  LOW: { label: t("task.priorityLow"), style: "text-slate-300 border-slate-500/30 bg-slate-500/10" },
                  MEDIUM: { label: t("task.priorityMedium"), style: "text-amber-300 border-amber-500/30 bg-amber-500/10" },
                  HIGH: { label: t("task.priorityHigh"), style: "text-orange-300 border-orange-500/30 bg-orange-500/10" },
                  CRITICAL: { label: t("task.priorityCritical"), style: "text-rose-300 border-rose-500/30 bg-rose-500/10" },
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
          {/* Base Branch Selector - only for GIT projects in create mode */}
          {isGitProject && !isEditing && (
            <div className="space-y-2">
              <Label>{t("task.baseBranch")}</Label>
              {branchesLoading ? (
                <div className="text-sm text-muted-foreground">{t("task.branchLoading")}</div>
              ) : branches.length > 0 ? (
                <Select value={selectedBranch} onValueChange={(v) => setSelectedBranch(v ?? "")}>
                  <SelectTrigger className="w-full" data-testid="branch-selector">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((branch) => (
                      <SelectItem key={branch} value={branch}>{branch}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="text-sm text-muted-foreground">{t("task.branchNone")}</div>
              )}
            </div>
          )}
          {/* Labels */}
          {labels.length > 0 && (
            <div className="space-y-2">
              <Label>{t("task.labels")}</Label>
              <div className="flex flex-wrap gap-1.5">
                {labels.map((label) => {
                  const isSelected = selectedLabelIds.includes(label.id);
                  return (
                    <button
                      key={label.id}
                      type="button"
                      onClick={() => {
                        setSelectedLabelIds((prev) =>
                          isSelected ? prev.filter((id) => id !== label.id) : [...prev, label.id]
                        );
                      }}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
                        isSelected
                          ? "ring-1 ring-current/30"
                          : "opacity-50 hover:opacity-80"
                      }`}
                      style={{
                        backgroundColor: label.color + "20",
                        color: label.color,
                        borderColor: isSelected ? label.color + "40" : "transparent",
                        borderWidth: "1px",
                      }}
                    >
                      {label.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            className="bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25 hover:bg-amber-500/25"
          >
            {isEditing ? t("common.save") : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
